// src/auth/auth.service.ts
import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import {
    RegisterDto,
    LoginDto,
    UpdateProfileDto,
    ChangePasswordDto,
    RequestVerificationCodeDto,
    VerifyCodeAndSetPasswordDto,
} from './auth.dto';
import { SystemSettingsService } from '../settings/system-settings.service';
import * as bcrypt from 'bcryptjs';
import { SystemRole } from "../common/enums/prisma-enums";
import { CacheHelper } from '../common/services/cache.helper';
// ✅ NEW — ابزار رفرال مشترک
import { generateReferralCode, normalizeReferralCode, isReferralCollision } from '../common/utils/referral';

/** عمر کش پروفایل — با هر ویرایشِ مسیرهای شناخته‌شده فوراً باطل می‌شود */
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private systemSettings: SystemSettingsService,
        private cache: CacheHelper,
    ) {}

    // ============================================================
    // ✅ دریافت پروفایل — کش per-user (۵ دقیقه)
    //    باطل‌سازی فوری در همهٔ مسیرهای تغییر دیتای کاربر:
    //    updateProfile، آپلود/حذف فایل کاربر (file.service)،
    //    ساخت نهاد تجاری (business.service)، عضویت بازار (arm.service)
    //    — همه با cache.bust('profile:'+userId)
    // ============================================================
    async getProfile(userId: string) {
        return this.cache.wrap(`profile:${userId}`, [], PROFILE_CACHE_TTL_MS, () =>
            this.fetchProfile(userId));
    }

    /** باطل‌سازی کش پروفایل یک کاربر — از سرویس‌های دیگر هم صدا زده می‌شود */
    async bustProfileCache(userId: string) {
        await this.cache.bust(`profile:${userId}`);
    }

    private async fetchProfile(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                phone: true,
                fullName: true,
                status: true,
                locale: true,
                timezone: true,
                role: true,
                createdAt: true,
                updatedAt: true,
                lastLoginAt: true,
                membershipTier: true,
                isPhoneVerified: true,
                phoneVerifiedAt: true,
                temporaryPassword: true,
                nationalId: true,

                // فیلدهای پروفایل
                email: true,
                gender: true,
                birthDate: true,
                province: true,
                city: true,
                countryCode: true,
                provinceCode: true,
                cityCode: true,
                postalCode: true,
                address: true,
                bio: true,
                website: true,
                telegram: true,
                socialLinks: true,

                // ✅ رفرال
                referralCode: true,
                referredByUserId: true,
                referredAt: true,

                _count: {
                    select: {
                        businesses: true,      // ✅ نهادهای تجاری (catalogStartYear اینجاست)
                        armMemberships: true,
                        ads: true,
                        credits: true,
                        referrals: true,       // ✅ تعداد دعوت‌شدگان مستقیم
                    },
                },
            },
        });

        if (!user) {
            throw new NotFoundException({ errorCode: 'USER_NOT_FOUND', message: 'کاربر یافت نشد' });
        }

        const userFiles = await this.prisma.file.findMany({
            where: { relatedModel: 'User', relatedId: userId },
            select: { id: true, fieldKey: true, thumbnailPath: true, path: true },
        });
        const avatarFile = userFiles.find((f) => f.fieldKey === 'avatar') || null;

        return {
            ...user,
            birthDate: user.birthDate?.toISOString(),
            socialLinks: user.socialLinks ?? {},
            avatarFile,
        };
    }

    // ============================================================
    // ✅ ورود کاربر
    // ============================================================
    async login(dto: LoginDto, locale?: string) {
        const user = await this.prisma.user.findUnique({
            where: { phone: dto.phone },
        });

        if (!user) {
            throw new UnauthorizedException({
                errorCode: 'WRONG_CREDENTIALS',
                message: 'شماره موبایل یا رمز عبور اشتباه است',
            });
        }

        const valid = await bcrypt.compare(dto.password, user.passwordHash);
        if (!valid) {
            throw new UnauthorizedException({
                errorCode: 'WRONG_CREDENTIALS',
                message: 'شماره موبایل یا رمز عبور اشتباه است',
            });
        }

        await this.prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });

        const profile = await this.getProfile(user.id);

        return {
            message: 'ورود با موفقیت انجام شد',
            user: profile,
            access_token: this.jwtService.sign({
                sub: user.id,
                phone: user.phone,
                role: user.role,
                locale: user.locale || locale || 'fa',
                tv: user.tokenVersion, // ← لاگ‌اوت واقعی: نسخهٔ توکن
            }),
        };
    }

    // ============================================================
    // ✅ لاگ‌اوت واقعی — نسخهٔ توکن کاربر یکی زیاد می‌شود؛
    //    همهٔ access token های صادرشدهٔ قبلی فوراً باطل می‌شوند
    //    (jwt.strategy نسخهٔ توکن را با DB می‌سنجد)
    // ============================================================
    async logout(userId: string) {
        await this.prisma.user.update({
            where: { id: userId },
            data: { tokenVersion: { increment: 1 } },
        });
        return { message: 'خروج با موفقیت انجام شد' };
    }

    // ============================================================
    // ✅ ثبت‌نام کاربر
    // ============================================================
    async register(dto: RegisterDto, locale?: string) {
        // ۱. بررسی تکراری نبودن شماره
        const existing = await this.prisma.user.findUnique({
            where: { phone: dto.phone },
        });

        if (existing) {
            throw new BadRequestException({
                errorCode: 'DUPLICATE_PHONE',
                message: 'این شماره موبایل قبلاً ثبت شده است',
            });
        }

        // ۲. resolve کد دعوت‌کننده (اگر از لینک رفرال‌دار آمده)
        let referrerId: string | null = null;
        const refCode = normalizeReferralCode((dto as any).refCode ?? '');
        if (refCode) {
            const refUser = await this.prisma.user.findUnique({
                where: { referralCode: refCode },
                select: { id: true },
            });
            if (refUser) referrerId = refUser.id;
        }

        // ۳. خواندن تنظیمات اعتبار از سیستم
        const creditSettings = await this.systemSettings.getCreditSettings();
        const signupBonus = creditSettings.signupBonus;

        const hashed = await bcrypt.hash(dto.password, 10);

        // ۴. ثبت کاربر — انتساب دعوت‌کننده داخل همین create، نه با update جدا
        //    ⚠️ در مونگو فیلدِ غایب با فیلتر null پرزما match نمی‌شود؛
        //    updateMany بعد از create بی‌صدا no-op می‌شد (باگ تأییدشده)
        let newUser: any = null;
        let lastError: any = null;
        for (let attempt = 0; attempt < 5 && !newUser; attempt++) {
            try {
                newUser = await this.prisma.$transaction(async (prisma) => {
                    const created = await prisma.user.create({
                        data: {
                            phone: dto.phone,
                            fullName: dto.fullName || '',
                            passwordHash: hashed,
                            role: SystemRole.system_user,
                            locale: locale || 'fa',
                            isPhoneVerified: false,
                            referralCode: generateReferralCode(),
                            // ✅ first-touch — در همان لحظهٔ تولد سند
                            ...(referrerId ? {
                                referredByUserId: referrerId,
                                referredAt: new Date(),
                            } : {}),
                        },
                    });

                    await prisma.credit.create({
                        data: {
                            userId: created.id,
                            amount: 0,
                            currency: 'IRR',
                            creditCount: 50, // signupBonus,
                            pricePerCredit: 0,
                            creditType: 'bonus',
                            transactionType: 'signup_bonus',
                            description: `اعتبار هدیه ثبت‌نام (${signupBonus} اعتبار)`,
                            metadata: {
                                source: 'system_settings',
                                granted_at: new Date().toISOString(),
                            },
                        },
                    });

                    return created;
                });
            } catch (e: any) {
                if (isReferralCollision(e)) { lastError = e; continue; }
                throw e;
            }
        }
        if (!newUser) throw lastError;

        const profile = await this.getProfile(newUser.id);

        return {
            message: 'ثبت‌نام با موفقیت انجام شد',
            user: profile,
            access_token: this.jwtService.sign({
                sub: newUser.id,
                phone: newUser.phone,
                role: newUser.role,
                locale: newUser.locale,
                isPhoneVerified: newUser.isPhoneVerified,
                tv: newUser.tokenVersion, // ← لاگ‌اوت واقعی: نسخهٔ توکن
            }),
        };
    }

    // ============================================================
    // ✅ NEW — بررسی اعتبار کد رفرال (عمومی — برای نمایش «دعوت‌کننده» در فرم)
    // ============================================================
    async checkReferralCode(rawCode: string) {
        const code = normalizeReferralCode(rawCode);
        if (!code) return { valid: false };

        const user = await this.prisma.user.findUnique({
            where: { referralCode: code },
            select: { fullName: true },
        });

        return {
            valid: !!user,
            // فقط نام کوچک — حریم خصوصی
            inviterName: user?.fullName?.split(' ')[0] ?? null,
        };
    }

    // ============================================================
    // ✅ بررسی وجود شماره موبایل
    // ============================================================
    async checkPhone(phone: string) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { phone },
                select: { id: true },
            });
            return { exists: !!user };
        } catch (error: any) {
            console.error('Check phone error:', error);
            return { exists: false, error: error.message };
        }
    }

    // ============================================================
    // ✅ به‌روزرسانی پروفایل
    // ============================================================
    // ============================================================
    // ✅ به‌روزرسانی پروفایل
    // ============================================================
    async updateProfile(userId: string, dto: UpdateProfileDto) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new NotFoundException({ errorCode: 'USER_NOT_FOUND', message: 'کاربر یافت نشد' });
        }

        const updateData: any = {
            fullName: dto.fullName,
        };

        if (dto.email !== undefined) updateData.email = dto.email;
        if (dto.gender !== undefined) updateData.gender = dto.gender;
        if (dto.birthDate !== undefined) {
            updateData.birthDate = new Date(dto.birthDate);
        }
        if (dto.country !== undefined) updateData.country = dto.country;
        if (dto.province !== undefined) updateData.province = dto.province;
        if (dto.city !== undefined) updateData.city = dto.city;
        if (dto.countryCode !== undefined) updateData.countryCode = dto.countryCode;
        if (dto.provinceCode !== undefined) updateData.provinceCode = dto.provinceCode;
        if (dto.cityCode !== undefined) updateData.cityCode = dto.cityCode;
        if (dto.postalCode !== undefined) updateData.postalCode = dto.postalCode;
        if (dto.address !== undefined) updateData.address = dto.address;
        if (dto.bio !== undefined) updateData.bio = dto.bio;
        if ((dto as any).catalogStartYear !== undefined) updateData.catalogStartYear = (dto as any).catalogStartYear;
        if (dto.website !== undefined) updateData.website = dto.website;
        if (dto.telegram !== undefined) updateData.telegram = dto.telegram;
        if (dto.socialLinks !== undefined) updateData.socialLinks = dto.socialLinks;

        await this.prisma.user.update({
            where: { id: userId },
            data: updateData,
        });

        // ⚠️ دیتای خود کاربر تغییر کرد → کش پروفایل فوراً باطل
        await this.bustProfileCache(userId);

        return this.getProfile(userId);
    }

    // ============================================================
    // ✅ تغییر رمز عبور (با تایید رمز فعلی)
    // ============================================================
    async changePassword(userId: string, dto: ChangePasswordDto) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new NotFoundException({
                errorCode: 'USER_NOT_FOUND',
                message: 'کاربر یافت نشد',
            });
        }

        const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
        if (!valid) {
            throw new UnauthorizedException({
                errorCode: 'WRONG_PASSWORD',
                message: 'رمز عبور فعلی اشتباه است',
            });
        }

        const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

        // ⚠️ امنیتی: با تغییر رمز، همهٔ نشست‌های فعال هم باطل شوند
        const updatedUser = await this.prisma.user.update({
            where: { id: userId },
            data: {
                passwordHash: hashedPassword,
                temporaryPassword: false,
                tokenVersion: { increment: 1 },
            },
            select: {
                id: true,
                phone: true,
                fullName: true,
                role: true,
                temporaryPassword: true,
            },
        });

        return {
            message: 'رمز عبور با موفقیت تغییر یافت',
            user: updatedUser,
        };
    }

    // ============================================================
    // ✅ ارسال کد تایید برای فراموشی رمز
    // ============================================================
    async requestVerificationCode(dto: RequestVerificationCodeDto) {
        const user = await this.prisma.user.findUnique({
            where: { phone: dto.phone },
        });

        if (!user) {
            throw new NotFoundException({
                errorCode: 'USER_NOT_FOUND',
                message: 'کاربری با این شماره موبایل یافت نشد',
            });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();

        await this.prisma.verificationCode.create({
            data: {
                userId: user.id,
                code: code,
                type: 'password_reset',
                expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            },
        });

        // TODO: ارسال پیامک
        // await this.smsService.send(user.phone, `کد تایید شما: ${code}`);

        return {
            message: 'کد تایید به شماره موبایل شما ارسال شد',
            // code: code, // فقط برای تست
        };
    }

    // ============================================================
    // ✅ تایید کد و تنظیم رمز جدید (فراموشی رمز)
    // ============================================================
    async verifyCodeAndSetPassword(dto: VerifyCodeAndSetPasswordDto) {
        const user = await this.prisma.user.findUnique({
            where: { phone: dto.phone },
        });

        if (!user) {
            throw new NotFoundException({
                errorCode: 'USER_NOT_FOUND',
                message: 'کاربری با این شماره موبایل یافت نشد',
            });
        }

        const verification = await this.prisma.verificationCode.findFirst({
            where: {
                userId: user.id,
                code: dto.code,
                type: 'password_reset',
                expiresAt: { gt: new Date() },
                used: false,
            },
        });

        if (!verification) {
            throw new BadRequestException({
                errorCode: 'INVALID_OR_EXPIRED_CODE',
                message: 'کد تایید نامعتبر یا منقضی شده است',
            });
        }

        const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

        await this.prisma.$transaction([
            // ⚠️ امنیتی: با تغییر رمز، همهٔ نشست‌های فعال هم باطل شوند
            this.prisma.user.update({
                where: { id: user.id },
                data: {
                    passwordHash: hashedPassword,
                    temporaryPassword: false,
                    tokenVersion: { increment: 1 },
                },
            }),
            this.prisma.verificationCode.update({
                where: { id: verification.id },
                data: { used: true },
            }),
        ]);

        await this.prisma.verificationCode.deleteMany({
            where: {
                userId: user.id,
                expiresAt: { lt: new Date() },
            },
        });

        return {
            message: 'رمز عبور با موفقیت تغییر یافت. اکنون می‌توانید وارد شوید.',
        };
    }

    // ============================================================
    // ✅ دریافت تاریخچه اعتبار کاربر
    // ============================================================
    async getUserCreditHistory(userId: string, limit = 20, offset = 0) {
        const transactions = await this.prisma.credit.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
        });

        const total = await this.prisma.credit.count({
            where: { userId },
        });

        return {
            transactions,
            pagination: {
                limit,
                offset,
                total,
            },
        };
    }
}