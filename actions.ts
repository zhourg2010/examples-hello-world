// actions.ts — 后台的"变更操作"。只做事,不管怎么呈现。
//
// 抽出来的原因:同一套操作现在有两个前端在用 ——
//   老后台(routes/admin.ts)   做完跳转 303,整页刷新
//   桌面版(routes/os.ts)      做完返回 JSON,前端局部更新窗口,不刷新
// 如果两边各写一份,迟早会走偏(一边加了校验另一边没加,这种 bug 极难发现)。
// 所以这里只负责"执行 + 说清楚发生了什么",呈现交给各自的路由。

import { genId } from "./auth.ts";
import {
  addDevice, deleteDevice, getServiceState, importBackup, listDevices,
  restorePrevNodes, saveNodes, setDevice, setServiceUp,
} from "./kv.ts";
import { DEFAULT_FORMAT, DEFAULT_FORMAT_TAGS } from "./formats.ts";
import { sendMail } from "./mail.ts";

export interface ActionResult {
  ok: boolean;
  /** 给人看的一句话。老后台塞进 notice 条,桌面版弹成通知。 */
  msg: string;
}

/** 认识的变更操作。不认识的返回 null,调用方自己决定怎么办(通常是忽略)。 */
export async function runAction(action: string, f: FormData): Promise<ActionResult | null> {
  const str = (k: string) => String(f.get(k) ?? "").trim();

  switch (action) {
    case "add": {
      const username = str("username");
      if (!username) return { ok: false, msg: "用户名不能为空" };
      // 备注留空就自动生成 8 位数字当设备码
      const note = str("note") || Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("");
      const raw = str("format") || DEFAULT_FORMAT;
      const format = (DEFAULT_FORMAT_TAGS as readonly string[]).includes(raw) ? raw : DEFAULT_FORMAT;
      const created = await addDevice(username, genId(), note, format);
      return created
        ? { ok: true, msg: `已添加设备 ${username}` }
        : { ok: false, msg: `设备 ${username} 已存在` };
    }

    case "switchformat": { // 在 formats.ts 登记的默认格式之间轮换
      const u = str("username");
      const dev = (await listDevices()).find((d) => d.username === u);
      if (!dev) return { ok: false, msg: "找不到这台设备" };
      const tags = DEFAULT_FORMAT_TAGS as readonly string[];
      const i = tags.indexOf(dev.format ?? DEFAULT_FORMAT);
      const next = tags[(i + 1) % tags.length];
      await setDevice(u, { format: next });
      return { ok: true, msg: `${u} 的默认格式已切换为 ${next}` };
    }

    case "toggle": {
      const u = str("username");
      const dev = (await listDevices()).find((d) => d.username === u);
      if (!dev) return { ok: false, msg: "找不到这台设备" };
      await setDevice(u, { enabled: !dev.enabled });
      return { ok: true, msg: `${u} 已${dev.enabled ? "停用" : "启用"}` };
    }

    case "rotate": { // 换链接:保留名字和备注,只换 id
      const u = str("username");
      if (!u) return { ok: false, msg: "缺少用户名" };
      await setDevice(u, { id: genId() });
      return { ok: true, msg: `${u} 的链接已更换,旧链接立即失效` };
    }

    case "del": {
      const u = str("username");
      if (!u) return { ok: false, msg: "缺少用户名" };
      await deleteDevice(u);
      return { ok: true, msg: `已删除设备 ${u}` };
    }

    case "savenodes": {
      // 这里**不做**空内容拦截:后台的"清空节点"是个合法操作(saveNodes 自带历史版本,
      // 存错了能恢复上一版)。跟 /push 那条路不一样 —— 那边是自动推送,推空多半是
      // 上游出故障,所以那边必须拦。
      await saveNodes(String(f.get("nodes") ?? ""));
      return { ok: true, msg: "节点已保存" };
    }

    case "restorenodes": {
      const ok = await restorePrevNodes();
      return { ok, msg: ok ? "已恢复到上一版节点" : "没有可恢复的历史" };
    }

    case "importbackup": {
      try {
        const r = await importBackup(JSON.parse(String(f.get("backup") ?? "")));
        return { ok: true, msg: `已恢复 ${r.devices} 台设备及节点` };
      } catch (e) {
        return { ok: false, msg: "恢复失败:" + (e instanceof Error ? e.message : String(e)) };
      }
    }

    case "service": {
      // 服务总开关。传 up=1 开、up=0 关;都不传就是**切换**(桌面版那个按钮用的)。
      const raw = str("up");
      const next = raw === "" ? !(await getServiceState()).up : raw === "1";
      await setServiceUp(next);
      // 两条都是 ok:true —— 操作本身成功了。曾经想用 ok:false 让"已关闭"这条显眼一点,
      // 结果通知条上顶着"出错了"三个字,而根本没出错,纯属误导。
      // "服务关着"这个状态由系统页上那块红底横幅长期提示,不该靠一条 3 秒就消失的通知。
      return next
        ? { ok: true, msg: "服务已开启,订阅链接恢复正常" }
        : { ok: true, msg: "服务已关闭,所有订阅链接现在一律 404" };
    }

    case "testmail": {
      const r = await sendMail(
        "订阅管理 - 测试邮件",
        `这是一封测试邮件。\n收到说明邮件配置正常。\n时间: ${new Date().toISOString()}`,
      );
      return r.ok
        ? { ok: true, msg: "测试邮件已发送,请查收(含垃圾箱)" }
        : { ok: false, msg: "发送失败: " + (r.error ?? "未知错误") };
    }
  }
  return null;
}
