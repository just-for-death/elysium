import { useCallback, useEffect, useState } from "react";

type PushStatus = "unsupported" | "denied" | "granted" | "default" | "loading";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/**
 * Hook that manages Web Push notification subscriptions.
 *
 * Usage:
 *   const { status, subscribe, unsubscribe } = usePushNotifications();
 */
export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [subscription, setSubscription] =
    useState<PushSubscription | null>(null);

  const isSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  useEffect(() => {
    if (!isSupported) {
      setStatus("unsupported");
      return;
    }
    setStatus(Notification.permission as PushStatus);

    // Check for existing subscription
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setSubscription(sub);
      });
    });
  }, [isSupported]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;

    try {
      setStatus("loading");

      // Request permission
      const permission = await Notification.requestPermission();
      setStatus(permission as PushStatus);
      if (permission !== "granted") return false;

      // Fetch VAPID public key from our server
      const keyRes = await fetch("/push/vapid-public-key");
      if (!keyRes.ok) {
        console.warn("[push] Server did not return a VAPID key – push disabled");
        return false;
      }
      const { key } = await keyRes.json();
      const applicationServerKey = urlBase64ToUint8Array(key).buffer as ArrayBuffer;

      // Subscribe via PushManager
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      setSubscription(sub);

      // Send subscription to our server
      await fetch("/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });

      return true;
    } catch (err) {
      console.error("[push] Subscribe error:", err);
      setStatus(Notification.permission as PushStatus);
      return false;
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!subscription) return false;
    try {
      await fetch("/push/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
      setSubscription(null);
      return true;
    } catch (err) {
      console.error("[push] Unsubscribe error:", err);
      return false;
    }
  }, [subscription]);

  return {
    isSupported,
    status,
    isSubscribed: !!subscription,
    subscribe,
    unsubscribe,
  };
}
