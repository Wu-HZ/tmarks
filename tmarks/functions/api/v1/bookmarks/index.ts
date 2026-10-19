import type { PagesFunction } from '@cloudflare/workers-types'
import type { Env, BookmarkRow, RouteParams, SQLParam } from '../../../lib/types'
import { success, badRequest, created, internalError } from '../../../lib/response'
import { requireAuth, AuthContext } from '../../../middleware/auth'
import { fetchFullBookmarks } from '../../../lib/data-fetchers'
import { isValidUrl, sanitizeString } from '../../../lib/validation'
import { generateUUID } from '../../../lib/crypto'
import { normalizeBookmark } from '../../../lib/bookmark-utils'
import { getValidTagIds, replaceBookmarkTags, replaceBookmarkTagsByNames } from '../../../lib/tags'
import { invalidatePublicShareCache } from '../../shared/cache'
import { uploadCoverImageToR2 } from '../../../lib/image-upload'

export const onRequestGet: PagesFunction<Env, RouteParams, AuthContext>[] = [
  requireAuth,
  async (context) => {
    const { env, request, data } = context
    const db = env.DB
    const userId = data.user_id

    if (!userId) {
      return badRequest('User not authenticated')
    }

    try {
      const url = new URL(request.url)
      const keyword = url.searchParams.get('keyword')
      const tagIds = url.searchParams.get('tagIds')?.split(',').filter(Boolean)
      const groupId = url.searchParams.get('groupId')
      const sortBy = url.searchParams.get('sortBy') || 'created_at'
      const sortOrder = url.searchParams.get('sortOrder') || 'DESC'
      const limit = parseInt(url.searchParams.get('limit') || '50', 10) || 50
      const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0

      let query = `
        SELECT DISTINCT b.*
        FROM bookmarks b
        LEFT JOIN bookmark_tags bt ON b.id = bt.bookmark_id
        WHERE b.user_id = ?
      `
      const params: SQLParam[] = [userId]

      const conditions: string[] = []
      const conditionParams: SQLParam[] = []

      if (keyword) {
        conditions.push('(b.title LIKE ? OR b.description LIKE ? OR b.url LIKE ?)')
        const searchPattern = `%${keyword}%`
        conditionParams.push(searchPattern, searchPattern, searchPattern)
      }

      if (tagIds && tagIds.length > 0) {
        conditions.push(`bt.tag_id IN (${tagIds.map(() => '?').join(',')})`)
        conditionParams.push(...tagIds)
      }

      if (groupId) {
        if (groupId === 'none') {
          conditions.push('b.group_id IS NULL')
        } else {
          conditions.push('b.group_id = ?')
          conditionParams.push(groupId)
        }
      }

      if (conditions.length > 0) {
        query += ' AND ' + conditions.join(' AND ')
      }

      const countQuery = `SELECT COUNT(DISTINCT b.id) as total FROM bookmarks b LEFT JOIN bookmark_tags bt ON b.id = bt.bookmark_id WHERE b.user_id = ? ${conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : ''}`
      const totalResult = await db.prepare(countQuery).bind(userId, ...conditionParams).first<{ total: number }>()
      const total = totalResult?.total || 0

      const validSortFields = ['created_at', 'updated_at', 'title']
      const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at'
      const direction = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'

      query += ` ORDER BY b.${sortField} ${direction} LIMIT ? OFFSET ?`
      params.push(...conditionParams, limit, offset)

      const { results: rows } = await db.prepare(query).bind(...params).all<BookmarkRow>()

      const bookmarks = await fetchFullBookmarks(db, rows, userId)

      return success({
        bookmarks,
        pagination: {
          total,
          limit,
          offset,
        },
      })
    } catch (error: unknown) {
      console.error('Fetch bookmarks error:', error)
      return internalError('Failed to fetch bookmarks')
    }
  },
]

interface CreateBookmarkRequest {
  title?: string
  url?: string
  description?: string
  cover_image?: string
  favicon?: string
  tag_ids?: string[]
  tags?: string[]
  is_pinned?: boolean
  is_archived?: boolean
  is_public?: boolean
}

export const onRequestPost: PagesFunction<Env, RouteParams, AuthContext>[] = [
  requireAuth,
  async (context) => {
    const { env, request, data } = context
    const userId = data.user_id

    if (!userId) {
      return badRequest('User not authenticated')
    }

    try {
      const body = await request.json() as CreateBookmarkRequest
      if (!body.title || !body.url) {
        return badRequest('Title and URL are required')
      }
      if (!isValidUrl(body.url)) {
        return badRequest('Invalid URL format')
      }

      const title = sanitizeString(body.title, 500)
      const url = sanitizeString(body.url, 2000)
      const description = body.description ? sanitizeString(body.description, 1000) : null
      let coverImage = body.cover_image ? sanitizeString(body.cover_image, 2000) : null
      const favicon = body.favicon ? sanitizeString(body.favicon, 2000) : null
      const now = new Date().toISOString()

      const existing = await env.DB.prepare(
        'SELECT id, deleted_at FROM bookmarks WHERE user_id = ? AND url = ?'
      )
        .bind(userId, url)
        .first<{ id: string; deleted_at: string | null }>()

      if (existing && !existing.deleted_at) {
        const bookmarkRow = await env.DB.prepare(
          'SELECT * FROM bookmarks WHERE id = ? AND user_id = ?'
        )
          .bind(existing.id, userId)
          .first<BookmarkRow>()

        if (!bookmarkRow) {
          return internalError('Failed to retrieve bookmark')
        }

        const { results: tags } = await env.DB.prepare(
          `SELECT t.id, t.name, t.color
           FROM tags t
           INNER JOIN bookmark_tags bt ON t.id = bt.tag_id
           WHERE bt.bookmark_id = ? AND bt.user_id = ?`
        )
          .bind(existing.id, userId)
          .all<{ id: string; name: string; color: string | null }>()

        return success(
          { bookmark: { ...normalizeBookmark(bookmarkRow), tags: tags || [] } },
          { message: 'Bookmark already exists', code: 'BOOKMARK_EXISTS' }
        )
      }

      let coverImageId: string | null = null
      if (coverImage && env.SNAPSHOTS_BUCKET && env.R2_PUBLIC_URL) {
        const bookmarkId = existing?.id || generateUUID()
        const upload = await uploadCoverImageToR2(
          coverImage,
          userId,
          bookmarkId,
          env.SNAPSHOTS_BUCKET,
          env.DB,
          env.R2_PUBLIC_URL,
          env
        )
        if (upload.success && upload.r2Url) {
          coverImage = upload.r2Url
          coverImageId = upload.imageId || null
        }
      }

      const bookmarkId = existing?.id || generateUUID()
      const isPinned = body.is_pinned ? 1 : 0
      const isArchived = body.is_archived ? 1 : 0
      const isPublic = body.is_public ? 1 : 0

      if (existing) {
        await env.DB.prepare(
          `UPDATE bookmarks
           SET title = ?, description = ?, cover_image = ?, cover_image_id = ?, favicon = ?,
               is_pinned = ?, is_archived = ?, is_public = ?, deleted_at = NULL, updated_at = ?
           WHERE id = ? AND user_id = ?`
        )
          .bind(title, description, coverImage, coverImageId, favicon, isPinned, isArchived, isPublic, now, bookmarkId, userId)
          .run()
      } else {
        await env.DB.prepare(
          `INSERT INTO bookmarks
           (id, user_id, title, url, description, cover_image, cover_image_id, favicon,
            is_pinned, is_archived, is_public, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(bookmarkId, userId, title, url, description, coverImage, coverImageId, favicon,
            isPinned, isArchived, isPublic, now, now)
          .run()
      }

      if (body.tags !== undefined) {
        await replaceBookmarkTagsByNames(env.DB, bookmarkId, body.tags, userId, now)
      } else if (body.tag_ids !== undefined) {
        const validTagIds = await getValidTagIds(env.DB, userId, body.tag_ids)
        await replaceBookmarkTags(env.DB, bookmarkId, userId, validTagIds, now)
      }

      const bookmarkRow = await env.DB.prepare(
        'SELECT * FROM bookmarks WHERE id = ? AND user_id = ?'
      )
        .bind(bookmarkId, userId)
        .first<BookmarkRow>()

      if (!bookmarkRow) {
        return internalError('Failed to load bookmark after creation')
      }

      const { results: tags } = await env.DB.prepare(
        `SELECT t.id, t.name, t.color
         FROM tags t
         INNER JOIN bookmark_tags bt ON t.id = bt.tag_id
         WHERE bt.bookmark_id = ? AND bt.user_id = ?`
      )
        .bind(bookmarkId, userId)
        .all<{ id: string; name: string; color: string | null }>()

      await invalidatePublicShareCache(env, userId)
      return created({ bookmark: { ...normalizeBookmark(bookmarkRow), tags: tags || [] } })
    } catch (error) {
      console.error('Create bookmark error:', error)
      return internalError('Failed to create bookmark')
    }
  },
]
