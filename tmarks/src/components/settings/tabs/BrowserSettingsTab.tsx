import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, ExternalLink, Info, Shield } from 'lucide-react'
import { InfoBox } from '../InfoBox'
import { SettingsSection, SettingsDivider } from '../SettingsSection'

const EXTENSION_SOURCE = 'https://github.com/Wu-HZ/tmarks/tree/main/tab'

export function BrowserSettingsTab() {
  const { t } = useTranslation('settings')
  const [showInstallGuide, setShowInstallGuide] = useState(false)
  const [showFaq, setShowFaq] = useState(false)

  return (
    <div className="space-y-6">
      <SettingsSection icon={ExternalLink} title={t('browser.download.title')} description={t('browser.download.description')}>
        <a href={EXTENSION_SOURCE} target="_blank" rel="noopener noreferrer" className="btn btn-primary inline-flex items-center gap-2">
          {t('browser.download.clickToDownload')} <ExternalLink className="w-4 h-4" />
        </a>
        <p className="mt-2 text-xs text-muted-foreground">{t('browser.download.tip')}</p>
      </SettingsSection>

      <SettingsDivider />
      <SettingsSection icon={Shield} title={t('browser.permissions.title')} description={t('browser.permissions.description')}>
        <div className="grid sm:grid-cols-3 gap-3">
          {['bookmarks', 'tabs', 'storage'].map(perm => (
            <div key={perm} className="p-3 rounded-lg bg-muted/30 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-4 h-4 text-success" />
                <span className="text-sm font-medium">{t(`browser.permissions.${perm}.title`)}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t(`browser.permissions.${perm}.description`)}</p>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsDivider />
      <button type="button" onClick={() => setShowInstallGuide(!showInstallGuide)}
        className="w-full flex items-center justify-between p-4 bg-card border border-border rounded-lg">
        <span className="inline-flex items-center gap-3"><Info className="w-5 h-5" />{t('browser.install.title')}</span>
        {showInstallGuide ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
      </button>
      {showInstallGuide && <div className="space-y-2 pl-4">
        {[1, 2, 3, 4, 5, 6].map(step => <div key={step} className="flex gap-3 p-3 bg-muted/30 rounded-lg">
          <span className="w-6 h-6 rounded-full bg-primary/10 text-center text-xs leading-6">{step}</span>
          <div>
            <div className="text-sm font-medium">{t(`browser.install.step${step}Title`)}</div>
            <div className="text-xs text-muted-foreground">{t(`browser.install.step${step}Desc`)}</div>
          </div>
        </div>)}
        <p className="text-xs text-muted-foreground">Chrome: chrome://extensions/ · Edge: edge://extensions/</p>
      </div>}

      <SettingsDivider />
      <button type="button" onClick={() => setShowFaq(!showFaq)}
        className="w-full flex items-center justify-between p-4 bg-card border border-border rounded-lg">
        <span className="inline-flex items-center gap-3"><Info className="w-5 h-5" />{t('browser.faq.title')}</span>
        {showFaq ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
      </button>
      {showFaq && <div className="space-y-2 pl-4">
        {['iconNotFound', 'howToGetApiKey', 'supportedBrowsers'].map(faq => <div key={faq} className="p-3 bg-muted/30 rounded-lg">
          <div className="text-sm font-medium">{t(`browser.faq.${faq}`)}</div>
          <div className="text-xs text-muted-foreground">{t(`browser.faq.${faq}Answer`)}</div>
        </div>)}
      </div>}

      <SettingsDivider />
      <InfoBox icon={Info} title={t('browser.infoBox.title')} variant="info">
        <ul className="space-y-1 text-xs">
          <li>• {t('browser.infoBox.tip1')}</li>
          <li>• {t('browser.infoBox.tip2')}</li>
        </ul>
      </InfoBox>
    </div>
  )
}
