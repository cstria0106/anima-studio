"use client";

import * as React from "react";
import { Bell, BellOff, CheckCircle2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const ENABLED_KEY = "anima-studio:completion-notifications:v1";
const CHANGE_EVENT = "anima-studio:completion-notifications-change";

export interface CompletionNotice {
  id: string;
  title: string;
  body: string;
  tone?: "success" | "error" | "info";
}

export function useCompletionNotifications() {
  const [supported, setSupported] = React.useState(false);
  const [permission, setPermission] =
    React.useState<NotificationPermission>("default");
  const [enabled, setEnabled] = React.useState(false);
  const lastNotice = React.useRef("");

  React.useEffect(() => {
    const available = typeof window !== "undefined" && "Notification" in window;
    setSupported(available);
    if (!available) return;
    const synchronize = () => {
      setPermission(Notification.permission);
      setEnabled(
        Notification.permission === "granted" &&
          window.localStorage.getItem(ENABLED_KEY) === "true",
      );
    };
    synchronize();
    window.addEventListener(CHANGE_EVENT, synchronize);
    window.addEventListener("storage", synchronize);
    return () => {
      window.removeEventListener(CHANGE_EVENT, synchronize);
      window.removeEventListener("storage", synchronize);
    };
  }, []);

  const broadcast = React.useCallback(() => {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const requestPermission = React.useCallback(async () => {
    if (!supported) return false;
    const next = await Notification.requestPermission();
    setPermission(next);
    const nextEnabled = next === "granted";
    setEnabled(nextEnabled);
    window.localStorage.setItem(ENABLED_KEY, String(nextEnabled));
    broadcast();
    return nextEnabled;
  }, [broadcast, supported]);

  const setNotificationEnabled = React.useCallback(
    (next: boolean) => {
      if (!supported || permission !== "granted") return;
      setEnabled(next);
      window.localStorage.setItem(ENABLED_KEY, String(next));
      broadcast();
    },
    [broadcast, permission, supported],
  );

  const notify = React.useCallback(
    (notice: CompletionNotice) => {
      if (lastNotice.current === notice.id) return;
      lastNotice.current = notice.id;
      if (
        !supported ||
        !enabled ||
        permission !== "granted"
      ) {
        return;
      }
      const notification = new Notification(notice.title, {
        body: notice.body,
        tag: `anima-${notice.id}`,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    },
    [enabled, permission, supported],
  );

  return {
    supported,
    permission,
    enabled,
    requestPermission,
    setEnabled: setNotificationEnabled,
    notify,
  };
}

export interface CompletionNotificationPanelProps {
  controller: ReturnType<typeof useCompletionNotifications>;
}

export function CompletionNotificationPanel({
  controller,
}: CompletionNotificationPanelProps) {
  return (
    <section className="flex flex-col justify-between gap-3 rounded-lg border border-border/65 bg-background/25 p-3 sm:flex-row sm:items-center">
      <div className="flex items-start gap-3">
        {controller.enabled ? (
          <Bell className="mt-0.5 size-4 text-pink-300" />
        ) : (
          <BellOff className="mt-0.5 size-4 text-muted-foreground" />
        )}
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium">브라우저 완료 알림</p>
            <Badge
              variant={controller.enabled ? "success" : "secondary"}
            >
              {controller.enabled ? "켜짐" : "꺼짐"}
            </Badge>
          </div>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            탭이 뒤에 있어도 생성과 런타임 작업의 완료·실패를 알려줍니다.
          </p>
        </div>
      </div>
      {!controller.supported ? (
        <span className="inline-flex items-center gap-2 text-[10px] text-amber-200">
          <ShieldAlert className="size-3.5" />
          이 브라우저는 알림을 지원하지 않습니다.
        </span>
      ) : controller.permission !== "granted" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void controller.requestPermission()}
        >
          <Bell />
          알림 권한 요청
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant={controller.enabled ? "outline" : "soft"}
          onClick={() => controller.setEnabled(!controller.enabled)}
        >
          {controller.enabled ? <BellOff /> : <CheckCircle2 />}
          {controller.enabled ? "알림 끄기" : "알림 켜기"}
        </Button>
      )}
    </section>
  );
}
