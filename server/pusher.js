// Web Push 发送器：未配置 VAPID 密钥时整体停用（不报错，订阅接口返回 503）
import webpush from 'web-push';

export function createPusher({ publicKey, privateKey, subject, store }) {
  const configured = Boolean(publicKey && privateKey);
  if (configured) {
    webpush.setVapidDetails(subject || 'mailto:admin@localhost', publicKey, privateKey);
  }

  // 向一张地图的所有订阅者广播；失效订阅（410/404）顺手清理
  async function notifyMap(mapCode, payload) {
    if (!configured) return;
    let subscriptions;
    try {
      subscriptions = await store.listSubscriptions(mapCode);
    } catch {
      return; // 拿不到订阅名单就静默跳过，绝不影响主请求
    }
    const body = JSON.stringify(payload);
    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body
          );
        } catch (err) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await store.removeSubscription(sub.endpoint).catch(() => {});
          }
        }
      })
    );
  }

  return { configured, publicKey, notifyMap };
}
