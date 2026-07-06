const ADMIN_SESSION_KEY = "ecc-admin-session";

const getExpectedSessionValue = () => {
  const usernameHash = process.env.NEXT_PUBLIC_ADMIN_USERNAME_HASH || "";
  const passwordHash = process.env.NEXT_PUBLIC_ADMIN_PASSWORD_HASH || "";

  return `${usernameHash}:${passwordHash}`;
};

export const isAdminConfigured = () => {
  return Boolean(
    process.env.NEXT_PUBLIC_ADMIN_USERNAME_HASH &&
      process.env.NEXT_PUBLIC_ADMIN_PASSWORD_HASH
  );
};

const toHex = (buffer: ArrayBuffer) => {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
};

export const hashCredential = async (value: string) => {
  const normalized = value.trim();
  const data = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return toHex(hashBuffer);
};

export const validateAdminCredentials = async (
  username: string,
  password: string
) => {
  if (!isAdminConfigured()) {
    return { ok: false as const, reason: "not-configured" };
  }

  const [usernameHash, passwordHash] = await Promise.all([
    hashCredential(username),
    hashCredential(password),
  ]);

  const expectedUsernameHash = process.env.NEXT_PUBLIC_ADMIN_USERNAME_HASH || "";
  const expectedPasswordHash = process.env.NEXT_PUBLIC_ADMIN_PASSWORD_HASH || "";

  if (
    usernameHash !== expectedUsernameHash ||
    passwordHash !== expectedPasswordHash
  ) {
    return { ok: false as const, reason: "invalid-credentials" };
  }

  return { ok: true as const };
};

export const setAdminSession = (enabled: boolean) => {
  if (typeof window === "undefined") return;

  if (!enabled) {
    window.localStorage.removeItem(ADMIN_SESSION_KEY);
    return;
  }

  window.localStorage.setItem(ADMIN_SESSION_KEY, getExpectedSessionValue());
};

export const hasAdminSession = () => {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ADMIN_SESSION_KEY) === getExpectedSessionValue();
};