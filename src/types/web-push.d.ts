declare module "web-push" {
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
  export function sendNotification(
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    },
    payload?: string | Buffer | null,
    options?: {
      vapidDetails?: { subject: string; publicKey: string; privateKey: string };
      TTL?: number;
      urgency?: "very-low" | "low" | "normal" | "high";
      contentEncoding?: "aes128gcm" | "aesgcm";
    },
  ): Promise<unknown>;
}
