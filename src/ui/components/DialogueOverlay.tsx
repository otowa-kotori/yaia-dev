// DialogueOverlay — 对话系统 UI 叠加层
//
// z-[55]：高于 MobileNav (z-50) 和 Drawer (z-40)，低于 CatchUp overlay (z-[70])。
// 对话期间追帧可以正常覆盖对话层（离线恢复优先级高于对话交互）。
// 全屏半透明遮罩拦截所有底层点击，防止对话途中误触地图/菜单。
// 游戏 tick 引擎在后台继续运行，战斗/采集不暂停。

import { useStore } from "../hooks/useStore";
import type { GameStore } from "../store";
import { T } from "../text";

export function DialogueOverlay({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const ds = s.dialogueState;

  if (!ds || ds.kind === "end") return null;

  const speaker =
    ds.kind === "say" ? ds.speaker :
    ds.kind === "choice" ? ds.speaker :
    undefined;

  return (
    // 全屏遮罩：z-[55] 高于 MobileNav(z-50) 和 Drawer(z-40)，低于 CatchUp overlay(z-[70])
    <div
      className="fixed inset-0 z-[55] flex flex-col justify-end bg-black/50"
      // 点击遮罩空白区域不关闭，防止误操作
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── 对话框主体 ── */}
      {/* pb-safe 通过 Tailwind 的 safe-area 插件补底部安全区；
          没有插件时用固定 pb-20 保证手机端底部 tab 栏不遮挡。 */}
      <div className="w-full max-w-2xl mx-auto px-3 pb-20 lg:pb-6">
        <div
          className="rounded-xl border border-border bg-[#1a1a2e]/98 shadow-2xl backdrop-blur-sm"
          role="dialog"
          aria-label="对话"
          // 阻止冒泡，确保对话框内部点击不被遮罩层拦截
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Speaker 标签 ── */}
          {speaker && (
            <div className="px-5 pt-4 pb-0">
              <span className="inline-block px-2.5 py-0.5 rounded bg-accent/20 text-accent text-sm font-semibold tracking-wide">
                {speaker}
              </span>
            </div>
          )}

          {/* ── 台词正文 ── */}
          {ds.kind === "say" && (
            <div className="px-5 py-4">
              <p className="text-gray-100 text-base leading-relaxed">{ds.text}</p>
            </div>
          )}

          {/* ── 选项模式 ── */}
          {ds.kind === "choice" && (
            <div className="px-5 py-4 space-y-2">
              {ds.text && (
                <p className="text-gray-100 text-base leading-relaxed mb-4">{ds.text}</p>
              )}
              <div className="flex flex-col gap-2">
                {ds.choices.map((choice) => (
                  <button
                    key={choice.next}
                    type="button"
                    onClick={() => s.advanceDialogue(choice.next)}
                    className="w-full text-left px-4 py-2.5 rounded-lg border border-border bg-surface-light hover:border-accent/50 hover:bg-accent/10 text-gray-200 text-base transition-colors cursor-pointer"
                  >
                    <span className="text-accent mr-2">▶</span>
                    {choice.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── 底部操作栏 ── */}
          <div className="flex items-center justify-end gap-3 px-5 pb-4 pt-1">
            <button
              type="button"
              onClick={() => s.closeDialogue()}
              className="px-3 py-1 text-sm text-gray-500 hover:text-gray-300 cursor-pointer transition-colors"
            >
              {T.dialogueClose}
            </button>
            {ds.kind === "say" && (
              <button
                type="button"
                onClick={() => s.advanceDialogue(ds.next)}
                className="px-5 py-2 rounded-lg bg-accent/20 hover:bg-accent/30 text-accent text-base font-medium border border-accent/30 cursor-pointer transition-colors"
              >
                {T.dialogueContinue}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
