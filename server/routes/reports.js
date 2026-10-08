// 内容举报：UGC 平台必备的用户侧入口。
// 权限模型：
// - 带邀请码 → 可举报本地图内任意内容（地图成员语境）
// - 不带邀请码 → 只能举报"当前公开可见"的内容（公共广场语境），避免拿 id 探测私有内容
// 处置：owner 凭邀请码查询待处理举报并标记已处理（GET/POST 都要求有效邀请码）
import { Router } from 'express';
import { limiters } from '../ratelimit.js';

const TARGET_TYPES = ['place', 'comment', 'photo'];
const MAX_REASON = 40;
const MAX_DETAIL = 200;

function parseId(raw) {
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function notifyReport(report, target) {
  const line = `[report] #${report.id} ${report.target_type}#${report.target_id} map=${target.mapCode} reason=${report.reason} reporter=${report.reporter || '匿名'}`;
  console.warn(line);
  const webhook = process.env.REPORT_WEBHOOK;
  if (!webhook) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'text',
        text: { content: `【魔都·Explore 举报】${line}\ndetail=${report.detail || '-'}` },
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  } catch (err) {
    console.warn('[report] webhook 通知失败：', err?.message ?? err);
  }
}

export function createReportsRouter({ store }) {
  const router = Router();
  const reportLimiter = limiters.report();

  // 提交举报
  router.post('/', reportLimiter, async (req, res, next) => {
    try {
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      const targetType = TARGET_TYPES.includes(body.target_type) ? body.target_type : '';
      if (!targetType) {
        return res.status(400).json({ error: `target_type 必须是 ${TARGET_TYPES.join(' / ')}` });
      }
      const targetId = parseId(body.target_id);
      if (!targetId) return res.status(400).json({ error: 'target_id 必须是正整数' });
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON) : '';
      if (!reason) return res.status(400).json({ error: '请选择举报原因' });
      const detail = typeof body.detail === 'string' ? body.detail.trim().slice(0, MAX_DETAIL) : '';

      const target = await store.findReportTarget(targetType, targetId);
      if (!target) return res.status(404).json({ error: '举报对象不存在' });

      const clientCode =
        typeof body.map_code === 'string' ? body.map_code.trim().toUpperCase() : '';
      if (clientCode) {
        if (clientCode !== target.mapCode) {
          return res.status(404).json({ error: '举报对象不存在' });
        }
      } else if (!(await store.isPlacePublic(target.placeId))) {
        // 无邀请码时只能举报公开内容
        return res.status(404).json({ error: '举报对象不存在' });
      }

      const reporter =
        req.user?.nickname ??
        (typeof body.reporter === 'string' ? body.reporter.trim().slice(0, 30) : '');
      const report = await store.createReport({
        targetType,
        targetId,
        mapCode: target.mapCode,
        reason,
        detail,
        reporter,
        openid: req.user?.openid ?? '',
      });
      notifyReport(report, target);
      res.status(201).json({ id: report.id, status: report.status });
    } catch (err) {
      next(err);
    }
  });

  // 待处理举报列表（owner 凭邀请码）
  router.get('/', async (req, res, next) => {
    try {
      const code = (req.query.map ?? '').toString().trim().toUpperCase();
      if (!code) return res.status(400).json({ error: '缺少 map 参数（邀请码）' });
      if (!(await store.getMapByCode(code))) {
        return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      }
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'open';
      res.json({ reports: await store.listReports(code, { status }) });
    } catch (err) {
      next(err);
    }
  });

  // 标记已处理
  router.post('/:id/resolve', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'id 必须是正整数' });
      const code =
        typeof req.body?.map_code === 'string' ? req.body.map_code.trim().toUpperCase() : '';
      if (!code) return res.status(400).json({ error: '缺少邀请码（map_code）' });
      if (!(await store.getMapByCode(code))) {
        return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      }
      const done = await store.resolveReport(id, code);
      if (!done) return res.status(404).json({ error: '举报不存在或已处理' });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
