const WHATSAPP_WEB_URL = 'https://web.whatsapp.com/'

let waStatus = 'idle' // idle | ready

export const getWhatsAppStatus = () => waStatus

export const getWhatsAppWebUrl = () => WHATSAPP_WEB_URL

export const initWhatsApp = async () => {
  waStatus = 'ready'

  return {
    success: true,
    status: waStatus,
    url: WHATSAPP_WEB_URL,
  }
}
