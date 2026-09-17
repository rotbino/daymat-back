// src/common/utils/device-meta.ts
// ─────────────────────────────────────────────────────────────
// متادیتای سیستمی ثبت‌نام/ورود — پشت‌صحنه و کاملاً بی‌سروصدا
//   • مرورگر / OS / نوع دیوایس  → پارسِ User-Agent واقعیِ سرور (نه ادعای کلاینت)
//   • IP                        → از هدرهای پروکسی (x-forwarded-for / x-real-ip) یا اتصال
//   • لوکیشن غیردقیق            → جستجوی جغرافیاییِ IP (بدون هیچ پرامپت/اجازه‌ای از کاربر)
//   • مشخصات خام کلاینت         → صفحه، زبان، تایم‌زون، رم، هسته‌ها، شبکه — sanitize شده
// هیچ‌کدام نباید ثبت‌نام/ورود را کند یا خراب کنند → همهٔ مسیرها failure-tolerant
// ─────────────────────────────────────────────────────────────

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

/** استخراج IP واقعی کاربر — پشتِ Nginx/CDN اولین عضو x-forwarded-for معتبر است */
export function extractIpFromRequest(req: any): string | null {
    const candidates: string[] = [];
    const xff = req?.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
        // «client, proxy1, proxy2» — اولینِ قابل‌اعتماد
        candidates.push(...xff.split(',').map((s: string) => s.trim()));
    }
    const realIp = req?.headers?.['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim()) candidates.push(realIp.trim());
    if (typeof req?.ip === 'string' && req.ip.trim()) candidates.push(req.ip.trim());

    for (const c of candidates) {
        if (IPV4_RE.test(c)) return c;                    // IPv4 سالم
        if (c.includes(':') && c.length <= 45) return c;  // IPv6 سالم
    }
    return null;
}

/** IP لوکال/پرایوت — جستجوی جغرافیایی بی‌معناست */
export function isPrivateIp(ip: string | null | undefined): boolean {
    if (!ip) return true;
    if (ip.includes(':')) return /^(::1|f[cd]|fe80)/i.test(ip); // loopback / ULA / link-local
    const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return true;
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true; // multicast / reserved
    return false;
}

/** پارس سبک User-Agent — بدون وابستگی؛ پوشش مرورگرها/OSهای رایج ایران */
export function parseUserAgent(uaRaw: string | undefined | null): Record<string, string> {
    const ua = String(uaRaw ?? '').slice(0, 400);
    if (!ua) return {};
    const out: Record<string, string> = {};

    // ── نوع دیوایس — ترتیب مهم است (iPad «Mobile» ندارد) ──
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
        out.deviceType = 'tablet';
    } else if (/Mobi|iPhone|iPod|Windows Phone|IEMobile/i.test(ua)) {
        out.deviceType = 'mobile';
    } else {
        out.deviceType = 'desktop';
    }

    // ── مرورگر — خاص‌تر به عام‌تر؛ Edge/Opera/Samsung قبل از Chrome/Safari ──
    const browsers: Array<[RegExp, string]> = [
        [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'],
        [/OPR\/([\d.]+)|Opera[\s/]([\d.]+)/, 'Opera'],
        [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
        [/YaBrowser\/([\d.]+)/, 'Yandex'],
        [/Firefox\/([\d.]+)|FxiOS\/([\d.]+)/, 'Firefox'],
        [/CriOS\/([\d.]+)/, 'Chrome iOS'],
        [/Chrome\/([\d.]+)/, 'Chrome'],
        [/Version\/([\d.]+).*Safari/, 'Safari'],
        [/MSIE\s([\d.]+)|Trident\/.*rv:([\d.]+)/, 'Internet Explorer'],
    ];
    for (const [re, name] of browsers) {
        const m = ua.match(re);
        if (m) {
            out.browser = name;
            out.browserVersion = (m[1] || m[2] || '').split('.').slice(0, 2).join('.');
            break;
        }
    }

    // ── OS ──
    if (/Windows NT ([\d.]+)/.test(ua)) {
        out.os = 'Windows';
        const nt = RegExp.$1;
        out.osVersion = nt === '10.0' ? '10/11' : nt;
    } else if (/Android ([\d.]+)/.test(ua)) {
        out.os = 'Android';
        out.osVersion = RegExp.$1.split('.').slice(0, 2).join('.');
    } else if (/iPhone|iPad|iPod/.test(ua)) {
        const m = ua.match(/OS (\d+[_\d]*)/);
        out.os = 'iOS';
        out.osVersion = m ? m[1].replace(/_/g, '.') : '';
    } else if (/Mac OS X ([\d_.]+)/.test(ua)) {
        out.os = 'macOS';
        out.osVersion = RegExp.$1.replace(/_/g, '.').split('.').slice(0, 2).join('.');
    } else if (/Linux/.test(ua)) {
        out.os = 'Linux';
    }
    return out;
}

/** پاک‌سازی متادیتای خام کلاینت — فقط کلیدهای سفید‌لیست، اعداد محدود، رشته‌های بریده */
const STR_KEYS = ['language', 'timezone', 'platform'] as const;
const NUM_KEYS = ['timezoneOffset', 'deviceMemory', 'hardwareConcurrency', 'touchPoints', 'viewportWidth', 'viewportHeight', 'dpr'] as const;
const BOOL_KEYS = ['cookiesEnabled'] as const;

export function sanitizeClientMeta(raw: unknown): Record<string, any> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const src = raw as Record<string, any>;
    const out: Record<string, any> = {};

    for (const k of STR_KEYS) {
        const v = src[k];
        if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 120);
    }
    for (const k of NUM_KEYS) {
        const v = src[k];
        if (typeof v === 'number' && isFinite(v)) out[k] = Math.round(v * 100) / 100;
    }
    for (const k of BOOL_KEYS) {
        if (typeof src[k] === 'boolean') out[k] = src[k];
    }
    // ابعاد صفحه — «1280x720» یا {w,h}
    const scr = src.screen;
    if (typeof scr === 'string' && /^\d{2,5}x\d{2,5}$/.test(scr)) out.screen = scr;
    else if (scr && typeof scr === 'object') {
        const w = Number((scr as any).w ?? (scr as any).width);
        const h = Number((scr as any).h ?? (scr as any).height);
        if (isFinite(w) && isFinite(h)) {
            out.screen = { w: Math.round(w), h: Math.round(h) };
            const cd = Number((scr as any).colorDepth);
            if (isFinite(cd)) (out.screen as any).colorDepth = Math.round(cd);
        }
    }
    // وضعیت شبکه
    const conn = src.connection;
    if (conn && typeof conn === 'object') {
        const c: Record<string, any> = {};
        if (typeof conn.effectiveType === 'string') c.effectiveType = conn.effectiveType.slice(0, 16);
        if (typeof conn.downlink === 'number' && isFinite(conn.downlink)) c.downlink = conn.downlink;
        if (typeof conn.saveData === 'boolean') c.saveData = conn.saveData;
        if (Object.keys(c).length) out.connection = c;
    }
    return out;
}

/** جستجوی جغرافیایی IP — ip-api.com (رایگان/بدون کلید)؛ هر خطایی = null، هیچ‌وقت throw نمی‌کند */
export async function lookupIpGeo(ip: string | null | undefined, timeoutMs = 3000): Promise<Record<string, any> | null> {
    try {
        if (!ip || isPrivateIp(ip)) return null;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(
                `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,region,regionName,city,lat,lon,timezone,isp,mobile,proxy,hosting`,
                { signal: ctrl.signal },
            );
            if (!res.ok) return null;
            const j: any = await res.json();
            if (j?.status !== 'success') return null;
            return {
                country: j.country ?? null,
                countryCode: j.countryCode ?? null,
                region: j.regionName ?? null,
                city: j.city ?? null,
                lat: typeof j.lat === 'number' ? j.lat : null,
                lng: typeof j.lon === 'number' ? j.lon : null,
                timezone: j.timezone ?? null,
                isp: j.isp ?? null,
                mobile: !!j.mobile,
                proxy: !!j.proxy,
                hosting: !!j.hosting,
            };
        } finally {
            clearTimeout(timer);
        }
    } catch {
        return null; // سندباکس/شبکهٔ بسته/تایم‌اوت — بی‌اهمیت، تحلیلی است
    }
}

/**
 * متادیتای نهایی auth — ادغام sanitize کلاینت + حقیقتِ سرور (UA و IP از درخواست)
 * کلاینت هرچه خواست می‌فرستد؛ فقط این کلیدها وارد دیتابیس می‌شوند.
 */
export function buildAuthMeta(req: any, clientMeta: unknown): Record<string, any> {
    const uaHeader = req?.headers?.['user-agent'];
    const ua = Array.isArray(uaHeader) ? uaHeader[0] : uaHeader;
    const ip = extractIpFromRequest(req);
    const meta: Record<string, any> = {
        ...sanitizeClientMeta(clientMeta),
        ...parseUserAgent(ua),
        ip: ip ?? undefined,
        userAgent: String(ua ?? '').slice(0, 300) || undefined,
        capturedAt: new Date().toISOString(),
    };
    // کلیدهای undefined را حذف کن — سند تمیزِ مونگو
    for (const k of Object.keys(meta)) {
        if (meta[k] === undefined) delete meta[k];
    }
    return meta;
}
