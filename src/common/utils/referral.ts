import { randomInt } from 'crypto';

// الفبای بدون کاراکترهای مبهم (صفر، یک، I، l، O، o)
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';

/** تولید کد دعوت یکتا — پیش‌فرض ۸ کاراکتر (~۱.۱e14 حالت) */
export function generateReferralCode(len = 8): string {
    let s = '';
    for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    return s;
}

/** پاک‌سازی ورودی کد از سمت کاربر */
export function normalizeReferralCode(raw: string): string {
    return (raw ?? '').trim().slice(0, 16);
}

/** آیا خطا مربوط به برخورد یونیک referralCode است؟ */
export function isReferralCollision(err: any): boolean {
    return err?.code === 'P2002' &&
        JSON.stringify(err?.meta?.target ?? '').includes('referralCode');
}