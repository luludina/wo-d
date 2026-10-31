const SHARE_TITLE = '鸡蛋预约｜每天几颗，提前报好'
const SHARE_HOME_PATH = '/pages/index/index'
const SHARE_IMAGE_URL = '/assets/share-cover.png'

export function createShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
  return {
    title: SHARE_TITLE,
    path: SHARE_HOME_PATH,
    imageUrl: SHARE_IMAGE_URL,
  }
}

export function createTimelineShare(): WechatMiniprogram.Page.ICustomTimelineContent {
  return {
    title: SHARE_TITLE,
    query: 'from=timeline',
    imageUrl: SHARE_IMAGE_URL,
  }
}
