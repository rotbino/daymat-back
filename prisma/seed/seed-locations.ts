// prisma/seed/seed-locations.ts
import { PrismaClient } from '@prisma/client';
import { IranProvinces } from '../data/Iran-provice';

const prisma = new PrismaClient();

function toSlug(text: string): string {
    return text
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^آ-یa-zA-Z0-9\-]/g, '')
        .toLowerCase();
}

const countries = [
    {
        title: 'ایران',
        slug: 'iran',
        countryCode: 'IR',
        provinces: null,
    },
    {
        title: 'عراق',
        slug: 'iraq',
        countryCode: 'IQ',
        provinces: [
            { label: 'بغداد', code: 'IQ01', cities: [
                    { label: 'الکرخ', code: 'IQ0101' },
                    { label: 'الرصافه', code: 'IQ0102' },
                    { label: 'صدر سیتی', code: 'IQ0103' },
                ]},
            { label: 'بصره', code: 'IQ02', cities: [
                    { label: 'بصره مرکزی', code: 'IQ0201' },
                    { label: 'الزبیر', code: 'IQ0202' },
                ]},
            { label: 'نجف', code: 'IQ03', cities: [
                    { label: 'نجف اشرف', code: 'IQ0301' },
                    { label: 'کوفه', code: 'IQ0302' },
                ]},
        ],
    },
    {
        title: 'افغانستان',
        slug: 'afghanistan',
        countryCode: 'AF',
        provinces: [
            { label: 'کابل', code: 'AF01', cities: [
                    { label: 'کابل مرکزی', code: 'AF0101' },
                    { label: 'کارته نو', code: 'AF0102' },
                    { label: 'شهرنو', code: 'AF0103' },
                ]},
            { label: 'هرات', code: 'AF02', cities: [
                    { label: 'هرات مرکزی', code: 'AF0201' },
                    { label: 'انجیل', code: 'AF0202' },
                ]},
            { label: 'مزار شریف', code: 'AF03', cities: [
                    { label: 'مزار شریف مرکزی', code: 'AF0301' },
                    { label: 'دهدادی', code: 'AF0302' },
                ]},
        ],
    },
];

async function seedCountry(countryData: any) {
    const country = await prisma.location.create({
        data: {
            title: countryData.title,
            slug: countryData.slug,
            path: countryData.slug,
            level: 0,
            type: 'country',
            countryCode: countryData.countryCode,
            isActive: true,
        },
    });
    console.log(`✅ کشور ${countryData.title}`);

    const provinces = countryData.provinces === null ? IranProvinces : countryData.provinces;

    for (const province of provinces) {
        // ⬇ slug = کد استان (یکتا)
        const provinceCode = province.id || province.code;
        const provinceSlug = provinceCode;
        const provincePath = `${country.path}.${provinceSlug}`;

        const createdProvince = await prisma.location.create({
            data: {
                title: province.label,
                slug: provinceSlug,
                parentId: country.id,
                path: provincePath,
                level: 1,
                type: 'province',
                provinceCode: provinceCode,
                countryCode: countryData.countryCode,
                isActive: true,
            },
        });

        if (province.children) {
            for (const city of province.children) {
                // ⬇ slug = کد شهر (یکتا)
                const cityCode = city.id || city.code;
                const citySlug = cityCode;
                const cityPath = `${createdProvince.path}.${citySlug}`;

                await prisma.location.create({
                    data: {
                        title: city.label,
                        slug: citySlug,
                        parentId: createdProvince.id,
                        path: cityPath,
                        level: 2,
                        type: 'city',
                        provinceCode: provinceCode,
                        cityCode: cityCode,
                        countryCode: countryData.countryCode,
                        isActive: true,
                    },
                });
            }
        }
        console.log(`  ✅ ${province.label} (${province.children?.length || 0} شهر)`);
    }
}

async function main() {
    console.log('🌍 شروع سید...\n');

    const nulled = await prisma.location.updateMany({ data: { parentId: null } });
    console.log(`🔓 ${nulled.count} ارتباط قطع شد`);

    const deleted = await prisma.location.deleteMany();
    console.log(`🗑️ ${deleted.count} رکورد حذف شد\n`);

    for (const country of countries) {
        await seedCountry(country);
        console.log('');
    }

    console.log('🎉 سید کامل شد!');
}

main()
    .catch((e) => { console.error('❌', e); process.exit(1); })
    .finally(() => prisma.$disconnect());