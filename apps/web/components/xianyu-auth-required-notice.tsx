import Link from "next/link";
import { QrCode, WarningCircle } from "@phosphor-icons/react/dist/ssr";

export function XianyuAuthRequiredNotice({
  message = "当前没有可用的闲鱼登录会话，系统不会发起商品搜索。请使用闲鱼 App 扫码并确认后，再获取真实商品。",
}: {
  message?: string;
}) {
  return (
    <section className="xianyu-auth-required" role="status" aria-label="闲鱼账号需要鉴权">
      <WarningCircle size={22} weight="fill" aria-hidden="true" />
      <div>
        <strong>先完成闲鱼账号鉴权</strong>
        <p>{message}</p>
      </div>
      <Link className="button button-secondary" href="/settings#xianyu-account">
        <QrCode size={17} aria-hidden="true" />
        前往扫码鉴权
      </Link>
    </section>
  );
}
