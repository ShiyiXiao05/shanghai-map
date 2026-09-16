// 登录用户的身份盖章：已登录（req.user，来自 auth 中间件）则强制用服务端昵称，
// 客户端传的字段仅作未登录（网页端）兜底。返回 null 表示已写出错误响应，调用方直接 return。
export function identityOr401(req, res, clientValue) {
  if (!req.user) return clientValue;
  if (!req.user.nickname) {
    res.status(400).json({ error: '请先设置昵称', code: 'NEED_NICKNAME' });
    return null;
  }
  return req.user.nickname;
}
