// 微信定位适配层。调用前先完成隐私授权，再请求 GCJ-02 坐标。

function classifyFailure(error) {
  const message = String((error && error.errMsg) || '');
  if (/cancel/i.test(message)) return { ok: false, reason: 'cancel', message };
  if (/privacy/i.test(message)) return { ok: false, reason: 'privacy', message };
  if (/auth|deny|scope|permission/i.test(message)) {
    return { ok: false, reason: 'denied', message };
  }
  return { ok: false, reason: 'failed', message };
}

function callWithCallbacks(method, options) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const callbacks = {
      ...options,
      success: (result) => finish({ ok: true, data: result || {} }),
      fail: (error) => finish(classifyFailure(error)),
    };
    try {
      const returned = method(callbacks);
      // Some test doubles and wrappers expose a Promise in addition to callbacks.
      if (returned && typeof returned.then === 'function') {
        returned.then((result) => finish({ ok: true, data: result || {} })).catch((error) => finish(classifyFailure(error)));
      }
    } catch (error) {
      finish(classifyFailure(error));
    }
  });
}

function requestPrivacyAuthorization() {
  if (typeof wx.requirePrivacyAuthorize !== 'function') return Promise.resolve({ ok: true });
  return callWithCallbacks(wx.requirePrivacyAuthorize.bind(wx), {});
}

export async function getCurrentLocation() {
  if (typeof wx.getLocation !== 'function') return { ok: false, reason: 'unsupported' };

  const privacy = await requestPrivacyAuthorization();
  if (!privacy.ok) return privacy;

  const result = await callWithCallbacks(wx.getLocation.bind(wx), {
    type: 'gcj02',
    isHighAccuracy: true,
  });
  if (!result.ok) return result;

  const latitude = Number(result.data.latitude);
  const longitude = Number(result.data.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, reason: 'failed', message: '定位返回了无效坐标' };
  }
  return { ok: true, data: { latitude, longitude } };
}
