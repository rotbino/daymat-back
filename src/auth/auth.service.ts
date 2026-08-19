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
import {SystemRole} from "../common/enums/prisma-enums";


@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private systemSettings: SystemSettingsService,
    ) {}

    // ============================================================
    // ✅ ثبت‌نام کاربر
    // ============================================================
    // src/auth/auth.service.ts



// src/auth/auth.service.ts

    async getProfile(userId: string) {
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
                countryCode: true,      // ✅ اضافه شود
                provinceCode: true,     // ✅ اضافه شود
                cityCode: true,         // ✅ اضافه شود
                postalCode: true,
                address: true,
                bio: true,
                businessStartYear: true,
                website: true,
                telegram: true,
                socialLinks: true,

                _count: {
                    select: {
                        businesses: true,
                        armMemberships: true,
                        ads: true,
                        credits: true,
                    },
                },
            },
        });

        if (!user) {
            throw new NotFoundException({ errorCode: 'USER_NOT_FOUND', message: 'کاربر یافت نشد' });
        }

        // فایل‌های کاربر (آواتار)
        const userFiles = await this.prisma.file.findMany({
            where: { relatedModel: 'User', relatedId: userId },
            select: { id: true, fieldKey: true, thumbnailPath: true, path: true },
        });
        const avatarFile = userFiles.find(f => f.fieldKey === 'avatar') || null;

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
    // src/auth/auth.service.ts

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

        // ✅ استفاده از getProfile برای خروجی یکسان
        const profile = await this.getProfile(user.id);

        return {
            message: 'ورود با موفقیت انجام شد',
            user: profile,
            access_token: this.jwtService.sign({
                sub: user.id,
                phone: user.phone,
                role: user.role,
                locale: user.locale || locale || 'fa',
            }),
        };
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

        // ۲. خواندن تنظیمات اعتبار از سیستم
        const creditSettings = await this.systemSettings.getCreditSettings();
        const signupBonus = creditSettings.signupBonus;

        const hashed = await bcrypt.hash(dto.password, 10);

        // ۳. ثبت کاربر و اعتبار هدیه در یک تراکنش
        const user = await this.prisma.$transaction(async (prisma) => {
            const newUser = await prisma.user.create({
                data: {
                    phone: dto.phone,
                    fullName: dto.fullName || '',
                    passwordHash: hashed,
                    role: SystemRole.system_user,
                    locale: locale || 'fa',
                    isPhoneVerified: false,
                },
            });

            await prisma.credit.create({
                data: {
                    userId: newUser.id,
                    amount: 0,
                    currency: 'IRR',
                    creditCount:50,// signupBonus,
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

            return newUser;
        });

        // ✅ استفاده از getProfile برای بازگشت پروفایل یکسان
        const profile = await this.getProfile(user.id);

        return {
            message: 'ثبت‌نام با موفقیت انجام شد',
            user: profile,
            access_token: this.jwtService.sign({
                sub: user.id,
                phone: user.phone,
                role: user.role,
                locale: user.locale,
                isPhoneVerified: user.isPhoneVerified,
            }),
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
        } catch (error) {
            console.error('Check phone error:', error);
            return { exists: false, error: error.message };
        }
    }

    // ============================================================
    // ✅ به‌روزرسانی پروفایل (فقط نام و آواتار)
    // ============================================================
    // src/auth/auth.service.ts

// ============================================================
// ✅ به‌روزرسانی پروفایل (فقط نام)
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

        // افزودن فیلدهای جدید در صورت وجود
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
        if (dto.businessStartYear !== undefined) updateData.businessStartYear = dto.businessStartYear;
        if (dto.website !== undefined) updateData.website = dto.website;
        if (dto.telegram !== undefined) updateData.telegram = dto.telegram;
        if (dto.socialLinks !== undefined) updateData.socialLinks = dto.socialLinks;

        await this.prisma.user.update({
            where: { id: userId },
            data: updateData,
        });

        // بازگرداندن پروفایل کامل (مثل getProfile)
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

        const updatedUser = await this.prisma.user.update({
            where: { id: userId },
            data: {
                passwordHash: hashedPassword,
                temporaryPassword: false,
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

        // تولید کد ۶ رقمی
        const code = Math.floor(100000 + Math.random() * 900000).toString();

        // ذخیره کد در دیتابیس
        await this.prisma.verificationCode.create({
            data: {
                userId: user.id,
                code: code,
                type: 'password_reset',
                expiresAt: new Date(Date.now() + 5 * 60 * 1000), // ۵ دقیقه
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
        // ۱. پیدا کردن کاربر
        const user = await this.prisma.user.findUnique({
            where: { phone: dto.phone },
        });

        if (!user) {
            throw new NotFoundException({
                errorCode: 'USER_NOT_FOUND',
                message: 'کاربری با این شماره موبایل یافت نشد',
            });
        }

        // ۲. بررسی کد تایید
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

        // ۳. هش کردن رمز جدید
        const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

        // ۴. به‌روزرسانی رمز عبور و علامت‌گذاری کد به عنوان استفاده شده
        await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id: user.id },
                data: {
                    passwordHash: hashedPassword,
                    temporaryPassword: false,
                },
            }),
            this.prisma.verificationCode.update({
                where: { id: verification.id },
                data: { used: true },
            }),
        ]);

        // ۵. حذف کدهای منقضی شده
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