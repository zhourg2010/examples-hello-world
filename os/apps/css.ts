// os/apps/css.ts — 所有 app 片段共用的样式。
//
// 抽出来的原因很实际:六个 app 各自带一份几乎一样的 CSS,改一次要改六处,漏一处就
// 是"设备管理的按钮和备份的按钮长得不一样"这种没人会去提 bug 的慢性病。
//
// 每个片段都把 APP_CSS 原样吐一遍,不做去重。重复注入同名 <style> 是无害的
// (后面的覆盖前面的,值一模一样),而让外壳预先知道"哪个 app 需要哪些类"要贵得多 ——
// 那等于把每个 app 的样式依赖登记到外壳里,以后加 app 就得改两个文件。
//
// 深色窗口(AppSpec.dark)不在这里管:那种 app 自带一整套深色样式,见 access.ts。

/** 排版:标题 + 副标题 + 分隔线。 */
const TYPO = `
.body h3{font-size:15px;font-weight:700;color:#1d1d1f;margin-bottom:3px}
.body h4{font-size:13px;font-weight:700;color:#1d1d1f;margin:22px 0 7px}
.body .sub{font-size:12px;color:#86868b;margin-bottom:14px;line-height:1.55}
.body .sub strong{color:#1d1d1f;font-weight:600}
.body .hr{height:1px;background:#eaeaec;margin:18px 0}`;

/** 表格。设备管理、节点内容、免费节点池都用这一套。 */
const TABLE = `
.body table{width:100%;border-collapse:collapse;font-size:12.5px}
.body th{text-align:left;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:#86868b;padding:0 10px 7px 0;border-bottom:1px solid #eaeaec;white-space:nowrap}
.body td{padding:9px 10px 9px 0;border-bottom:1px solid #f2f2f4;color:#1d1d1f;vertical-align:middle}
.body tbody tr:last-child td{border-bottom:none}
.body tbody tr:hover{background:#fafafa}
.body .mono{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:11px;color:#86868b}
.body .pill{font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:20px;white-space:nowrap}
.body .pill.on{background:#e8f8ee;color:#1d8348}
.body .pill.off{background:#f2f2f4;color:#86868b}`;

/**
 * 键值表:左边一列窄标签,右边一列值。系统信息那种"一行一条"的内容用它,
 * 比拿普通表格硬撑要稳 —— 普通表格的列宽会被最长的那个值拽歪。
 */
const KV = `
.body table.kv td{border-bottom:1px solid #f2f2f4}
.body table.kv tr:hover{background:transparent}
.body table.kv td:first-child{width:170px;color:#86868b;font-size:11.5px;white-space:nowrap;vertical-align:top}
.body table.kv td:last-child{color:#1d1d1f}`;

/**
 * 按钮。primary 是"这一屏的主要动作",danger 用在不可撤销的操作上 ——
 * 平时不红,只有 hover 才红:一屏全是红按钮之后红色就不再是警告了。
 */
const BUTTON = `
.body .btn{font:inherit;font-size:12px;font-weight:500;padding:4px 10px;border-radius:7px;
  border:.5px solid #d0d0d6;background:#fff;color:#1d1d1f;cursor:pointer;
  box-shadow:0 1px 1.5px rgba(0,0,0,.05)}
.body .btn:hover{background:#f6f6f8}
.body .btn:disabled{opacity:.45;cursor:default;box-shadow:none}
.body .btn:disabled:hover{background:#fff}
.body .btn.primary{background:#0071e3;color:#fff;border-color:#0071e3}
.body .btn.primary:hover{background:#0062c4}
.body .btn.danger:hover{background:#fff1f0;color:#b3261e;border-color:#f0c4c0}
.body .btn.sm{font-size:11px;padding:2px 7px;border-radius:6px}`;

/** 表单控件:一行控件条(addbar)、整块输入框(field)。 */
const FORM = `
.body .addbar{display:flex;gap:7px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
.body .addbar input,.body .addbar select{font:inherit;font-size:12.5px;padding:6px 10px;border-radius:7px;
  border:.5px solid #d0d0d6;background:#fff;min-width:0}
.body .addbar input{flex:1;min-width:130px}
.body .addbar select{cursor:pointer}
.body .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}
.body textarea{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:11.5px;line-height:1.6;
  width:100%;padding:9px 11px;border-radius:8px;border:.5px solid #d0d0d6;background:#fff;
  color:#1d1d1f;resize:vertical}
.body textarea:focus,.body .addbar input:focus{outline:2px solid #0071e3;outline-offset:-1px;border-color:#0071e3}`;

/**
 * 提示条。**不用红色**:红色在这套界面里只留给"出事了",拿它当"请注意"用会
 * 让真出事的时候没人再当回事。所以警示条走琥珀色,信息条走中性灰。
 */
const NOTE = `
.body .note{font-size:12px;line-height:1.6;padding:10px 13px;border-radius:9px;margin:12px 0}
.body .note.info{background:#f5f5f7;color:#4a4a4f;border:.5px solid #e4e4e8}
.body .note.warn{background:#fff8e6;color:#7a5a00;border:.5px solid #f0e0b0}
.body .empty{color:#86868b;font-size:12.5px;padding:26px 2px;text-align:center}`;

/** 一行文字的状态摘要,配一个小圆点。 */
const DOT = `
.body .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:1px}
.body .dot.ok{background:#34c759}
.body .dot.warn{background:#ff9f0a}
.body .dot.off{background:#c7c7cc}`;

export const APP_CSS = `<style>${TYPO}${TABLE}${KV}${BUTTON}${FORM}${NOTE}${DOT}</style>`;

/** 相对时间。几个 app 都要,顺手放这儿,免得各写一份口径不同的。 */
export function ago(ts?: number): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}
