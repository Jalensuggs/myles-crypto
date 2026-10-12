import { useUiStore } from "@/stores/ui.store";
import { Dialog } from "./Dialog";

/** 登录占位弹窗。第一版没有账号系统，这里只说明现状。 */
export function AuthDialog() {
  const feature = useUiStore((s) => s.authFeature);
  const requireAuth = useUiStore((s) => s.requireAuth);
  return (
    <Dialog open={feature !== null} title="需要登录" onClose={() => requireAuth(null)} testId="auth-dialog">
      <p className="auth__lead">
        「{feature}」需要账号才能使用，登录功能还在开发中。
        <br />
        目前你的标签、布局和绘图都保存在这台设备的浏览器里，不登录也能正常使用。
      </p>
      <div className="auth__buttons">
        <button type="button" className="btn" disabled>
          使用 Google 账号登录（即将上线）
        </button>
        <button type="button" className="btn" disabled>
          使用邮箱登录（即将上线）
        </button>
        <button type="button" className="btn btn--primary" onClick={() => requireAuth(null)}>
          知道了
        </button>
      </div>
    </Dialog>
  );
}
