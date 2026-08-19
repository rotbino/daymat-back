//prisma/data/Activity.ts
export const Industries={
    "categories": [
        {
            "title": "ساختمان و عمران",
            "slug": "construction-civil",
            "children": [
                {
                    "title": "تولید و ساخت",
                    "slug": "production-manufacturing",
                    "children": [
                        {
                            "title": "تولیدکننده مصالح ساختمانی",
                            "slug": "building-material-manufacturer"
                        },
                        {
                            "title": "تولیدکننده تجهیزات ساختمانی",
                            "slug": "building-equipment-manufacturer"
                        },
                        {
                            "title": "تولیدکننده تجهیزات تأسیسات",
                            "slug": "building-installation-equipment-manufacturer"
                        },
                        {
                            "title": "تولیدکننده مصنوعات و اجزای ساختمانی",
                            "slug": "building-components-manufacturer"
                        },
                        {
                            "title": "کارگاه ساخت و تولید ساختمانی",
                            "slug": "building-workshop"
                        },
                        {
                            "title": "تولیدکننده سفارشی ساختمان",
                            "slug": "custom-building-manufacturer"
                        }
                    ]
                },

                {
                    "title": "تجارت و توزیع",
                    "slug": "trade-distribution",
                    "children": [
                        {
                            "title": "عمده‌فروش مصالح ساختمانی",
                            "slug": "building-material-wholesaler"
                        },
                        {
                            "title": "عمده‌فروش تجهیزات ساختمانی",
                            "slug": "building-equipment-wholesaler"
                        },
                        {
                            "title": "عمده‌فروش تجهیزات تأسیسات",
                            "slug": "building-installation-equipment-wholesaler"
                        },
                        {
                            "title": "توزیع‌کننده مصالح و تجهیزات ساختمانی",
                            "slug": "building-distributor"
                        },
                        {
                            "title": "نماینده و عامل فروش",
                            "slug": "sales-agent"
                        },
                        {
                            "title": "شرکت بازرگانی ساختمانی",
                            "slug": "construction-trading-company"
                        },
                        {
                            "title": "واردکننده مصالح و تجهیزات ساختمانی",
                            "slug": "building-importer"
                        },
                        {
                            "title": "صادرکننده مصالح و تجهیزات ساختمانی",
                            "slug": "building-exporter"
                        },
                        {
                            "title": "واسطه و کارگزار تجاری ساختمان",
                            "slug": "construction-broker"
                        }
                    ]
                },

                {
                    "title": "فروش و خرده‌فروشی",
                    "slug": "retail-sales",
                    "children": [
                        {
                            "title": "مصالح‌فروشی",
                            "slug": "building-material-store"
                        },
                        {
                            "title": "فروشگاه تجهیزات ساختمانی",
                            "slug": "building-equipment-store"
                        },
                        {
                            "title": "فروشگاه تأسیسات ساختمانی",
                            "slug": "building-installation-store"
                        },
                        {
                            "title": "فروشگاه تخصصی ساختمان",
                            "slug": "specialized-building-store"
                        },
                        {
                            "title": "فروشگاه چندمنظوره ساختمان",
                            "slug": "general-building-store"
                        }
                    ]
                },

                {
                    "title": "اجرا و نصب",
                    "slug": "execution-installation",
                    "children": [
                        {
                            "title": "اجرای عمومی ساختمان",
                            "slug": "general-building-execution"
                        },
                        {
                            "title": "اجرای سازه و اسکلت",
                            "slug": "structural-execution"
                        },
                        {
                            "title": "اجرای نازک‌کاری",
                            "slug": "finishing-execution"
                        },
                        {
                            "title": "اجرای تأسیسات",
                            "slug": "building-services-execution",
                            "children": [
                                {
                                    "title": "اجرای تأسیسات مکانیکی",
                                    "slug": "mechanical-services"
                                },
                                {
                                    "title": "اجرای تأسیسات برقی",
                                    "slug": "electrical-services"
                                },
                                {
                                    "title": "اجرای سیستم‌های سرمایش و گرمایش",
                                    "slug": "hvac-execution"
                                },
                                {
                                    "title": "اجرای سیستم‌های آب و فاضلاب",
                                    "slug": "plumbing-sewer-execution"
                                },
                                {
                                    "title": "اجرای سیستم‌های ایمنی و حفاظتی",
                                    "slug": "safety-security-systems"
                                }
                            ]
                        },
                        {
                            "title": "اجرای دکوراسیون و داخلی",
                            "slug": "interior-execution",
                            "children": [
                                {
                                    "title": "اجرای کابینت و آشپزخانه",
                                    "slug": "kitchen-cabinet-execution"
                                },
                                {
                                    "title": "اجرای دکوراسیون داخلی",
                                    "slug": "interior-decoration-execution"
                                },
                                {
                                    "title": "اجرای پارتیشن و فضاهای داخلی",
                                    "slug": "partition-execution"
                                }
                            ]
                        },
                        {
                            "title": "نصب اجزا و تجهیزات ساختمانی",
                            "slug": "building-component-installation",
                            "children": [
                                {
                                    "title": "نصب درب و پنجره",
                                    "slug": "door-window-installation"
                                },
                                {
                                    "title": "نصب تجهیزات تأسیساتی",
                                    "slug": "installation-equipment"
                                },
                                {
                                    "title": "نصب تجهیزات حفاظتی و امنیتی",
                                    "slug": "security-equipment-installation"
                                },
                                {
                                    "title": "نصب تجهیزات هوشمندسازی",
                                    "slug": "smart-building-installation"
                                }
                            ]
                        },
                        {
                            "title": "عایق‌کاری و آب‌بندی",
                            "slug": "insulation-waterproofing"
                        },
                        {
                            "title": "نما و اجرای نمای ساختمان",
                            "slug": "facade-execution"
                        },
                        {
                            "title": "محوطه‌سازی و اجرای فضای بیرونی",
                            "slug": "site-landscaping"
                        }
                    ]
                },

                {
                    "title": "پیمانکاری و مدیریت پروژه",
                    "slug": "contracting-project-management",
                    "children": [
                        {
                            "title": "پیمانکار عمومی ساختمان",
                            "slug": "general-contractor"
                        },
                        {
                            "title": "پیمانکار تخصصی ساختمان",
                            "slug": "specialized-contractor"
                        },
                        {
                            "title": "پیمانکار تأسیسات",
                            "slug": "mep-contractor"
                        },
                        {
                            "title": "پیمانکار برق",
                            "slug": "electrical-contractor"
                        },
                        {
                            "title": "پیمانکار مکانیک",
                            "slug": "mechanical-contractor"
                        },
                        {
                            "title": "پیمانکار عمرانی",
                            "slug": "civil-contractor"
                        },
                        {
                            "title": "مدیریت و اجرای پروژه",
                            "slug": "project-management"
                        },
                        {
                            "title": "شرکت پیمانکاری",
                            "slug": "construction-contracting-company"
                        }
                    ]
                },

                {
                    "title": "ساخت و توسعه ملک",
                    "slug": "property-development",
                    "children": [
                        {
                            "title": "انبوه‌ساز",
                            "slug": "mass-builder"
                        },
                        {
                            "title": "سازنده ساختمان",
                            "slug": "building-developer"
                        },
                        {
                            "title": "توسعه‌دهنده پروژه ساختمانی",
                            "slug": "real-estate-developer"
                        },
                        {
                            "title": "سرمایه‌گذار پروژه ساختمانی",
                            "slug": "construction-investor"
                        },
                        {
                            "title": "شرکت توسعه و ساخت",
                            "slug": "development-construction-company"
                        }
                    ]
                },

                {
                    "title": "طراحی، مهندسی و مشاوره",
                    "slug": "design-engineering-consulting",
                    "children": [
                        {
                            "title": "دفتر معماری",
                            "slug": "architecture-office"
                        },
                        {
                            "title": "مهندس معمار",
                            "slug": "architect"
                        },
                        {
                            "title": "مهندس سازه",
                            "slug": "structural-engineer"
                        },
                        {
                            "title": "مهندس تأسیسات",
                            "slug": "mep-engineer"
                        },
                        {
                            "title": "مهندس عمران",
                            "slug": "civil-engineer"
                        },
                        {
                            "title": "مهندس مشاور",
                            "slug": "engineering-consultant"
                        },
                        {
                            "title": "مهندس ناظر",
                            "slug": "supervising-engineer"
                        },
                        {
                            "title": "دفتر فنی و مهندسی",
                            "slug": "technical-engineering-office"
                        },
                        {
                            "title": "مشاور مدیریت پروژه",
                            "slug": "project-consultant"
                        }
                    ]
                },

                {
                    "title": "خدمات فنی و نگهداری ساختمان",
                    "slug": "building-maintenance-services",
                    "children": [
                        {
                            "title": "تعمیر و نگهداری ساختمان",
                            "slug": "building-maintenance"
                        },
                        {
                            "title": "تعمیرات تأسیسات",
                            "slug": "installation-repair"
                        },
                        {
                            "title": "تعمیرات برق ساختمان",
                            "slug": "building-electrical-repair"
                        },
                        {
                            "title": "تعمیرات مکانیکی ساختمان",
                            "slug": "building-mechanical-repair"
                        },
                        {
                            "title": "بازسازی ساختمان",
                            "slug": "building-renovation"
                        },
                        {
                            "title": "مرمت ساختمان",
                            "slug": "building-restoration"
                        },
                        {
                            "title": "خدمات مدیریت و نگهداری تأسیسات",
                            "slug": "facility-management"
                        }
                    ]
                },

                {
                    "title": "مالکیت و کارفرمایی",
                    "slug": "ownership-employer",
                    "children": [
                        {
                            "title": "مالک پروژه ساختمانی",
                            "slug": "project-owner"
                        },
                        {
                            "title": "کارفرمای پروژه",
                            "slug": "project-employer"
                        },
                        {
                            "title": "سازمان و نهاد پروژه‌ای",
                            "slug": "institutional-project-owner"
                        },
                        {
                            "title": "شرکت و مجموعه دارای پروژه ساختمانی",
                            "slug": "corporate-project-owner"
                        }
                    ]
                },

                {
                    "title": "خدمات تخصصی پشتیبان ساختمان",
                    "slug": "construction-support-services",
                    "children": [
                        {
                            "title": "آزمایشگاه و خدمات کنترل کیفیت ساختمان",
                            "slug": "construction-testing"
                        },
                        {
                            "title": "بازرسی و کنترل فنی",
                            "slug": "technical-inspection"
                        },
                        {
                            "title": "نقشه‌برداری و خدمات ژئوماتیک",
                            "slug": "surveying-geomatic"
                        },
                        {
                            "title": "خدمات ایمنی و HSE",
                            "slug": "construction-safety"
                        },
                        {
                            "title": "اجاره تجهیزات و ماشین‌آلات ساختمانی",
                            "slug": "construction-equipment-rental"
                        },
                        {
                            "title": "تأمین نیروی تخصصی ساختمان",
                            "slug": "construction-labor-supply"
                        }
                    ]
                }
            ]
        },
        {
            "title": "مواد غذایی و نوشیدنی",
            "slug": "food-beverage",
            "children": [
                {
                    "title": "تولید و فرآوری",
                    "slug": "production-processing",
                    "children": [
                        {
                            "title": "تولیدکننده مواد غذایی و نوشیدنی",
                            "slug": "food-beverage-manufacturer"
                        },
                        {
                            "title": "واحد فرآوری مواد غذایی",
                            "slug": "food-processing-unit"
                        },
                        {
                            "title": "تولیدکننده محصولات غذایی تخصصی",
                            "slug": "specialized-food-manufacturer"
                        },
                        {
                            "title": "تولیدکننده محصولات کشاورزی فرآوری‌شده",
                            "slug": "processed-agricultural-producer"
                        },
                        {
                            "title": "کارگاه تولید و فرآوری مواد غذایی",
                            "slug": "food-workshop"
                        },
                        {
                            "title": "تولیدکننده سفارشی و قراردادی مواد غذایی",
                            "slug": "contract-food-manufacturer"
                        }
                    ]
                },

                {
                    "title": "تجارت و واردات و صادرات",
                    "slug": "food-trade",
                    "children": [
                        {
                            "title": "واردکننده مواد غذایی و نوشیدنی",
                            "slug": "food-importer"
                        },
                        {
                            "title": "صادرکننده مواد غذایی و نوشیدنی",
                            "slug": "food-exporter"
                        },
                        {
                            "title": "شرکت بازرگانی مواد غذایی",
                            "slug": "food-trading-company"
                        },
                        {
                            "title": "نماینده و عامل فروش",
                            "slug": "food-sales-agent"
                        },
                        {
                            "title": "واسطه و کارگزار تجاری مواد غذایی",
                            "slug": "food-broker"
                        }
                    ]
                },

                {
                    "title": "عمده‌فروشی و تجارت عمده",
                    "slug": "wholesale",
                    "children": [
                        {
                            "title": "عمده‌فروش مواد غذایی و نوشیدنی",
                            "slug": "food-wholesaler"
                        },
                        {
                            "title": "بنکدار مواد غذایی",
                            "slug": "food-bonakdar"
                        },
                        {
                            "title": "تاجر و تأمین‌کننده عمده مواد غذایی",
                            "slug": "food-trader-supplier"
                        },
                        {
                            "title": "عمده‌فروش تخصصی",
                            "slug": "specialized-food-wholesaler"
                        }
                    ]
                },

                {
                    "title": "پخش و توزیع",
                    "slug": "distribution",
                    "children": [
                        {
                            "title": "شرکت پخش مواد غذایی",
                            "slug": "food-distribution-company"
                        },
                        {
                            "title": "توزیع‌کننده مواد غذایی",
                            "slug": "food-distributor"
                        },
                        {
                            "title": "پخش‌کننده منطقه‌ای",
                            "slug": "regional-distributor"
                        },
                        {
                            "title": "پخش‌کننده مویرگی",
                            "slug": "route-distributor"
                        },
                        {
                            "title": "نماینده پخش",
                            "slug": "distribution-agent"
                        },
                        {
                            "title": "عامل فروش و توزیع",
                            "slug": "sales-distribution-agent"
                        }
                    ]
                },

                {
                    "title": "خرده‌فروشی و فروشگاهی",
                    "slug": "retail",
                    "children": [
                        {
                            "title": "سوپرمارکت",
                            "slug": "supermarket"
                        },
                        {
                            "title": "فروشگاه مواد غذایی",
                            "slug": "food-store"
                        },
                        {
                            "title": "فروشگاه زنجیره‌ای",
                            "slug": "chain-store"
                        },
                        {
                            "title": "فروشگاه تعاونی",
                            "slug": "cooperative-store"
                        },
                        {
                            "title": "فروشگاه تخصصی مواد غذایی",
                            "slug": "specialized-food-store"
                        },
                        {
                            "title": "فروشگاه عمده و خرده",
                            "slug": "cash-carry-store"
                        },
                        {
                            "title": "فروشگاه اینترنتی مواد غذایی",
                            "slug": "online-food-store"
                        }
                    ]
                },

                {
                    "title": "خرده‌فروشی تخصصی",
                    "slug": "specialized-retail",
                    "children": [
                        {
                            "title": "میوه و تره‌بارفروشی",
                            "slug": "fruit-vegetable-store"
                        },
                        {
                            "title": "خشکبار و آجیل‌فروشی",
                            "slug": "nuts-dried-fruit-store"
                        },
                        {
                            "title": "لبنیات‌فروشی",
                            "slug": "dairy-store"
                        },
                        {
                            "title": "پروتئینی و گوشت‌فروشی",
                            "slug": "protein-meat-store"
                        },
                        {
                            "title": "نانوایی و واحد فروش نان",
                            "slug": "bakery"
                        },
                        {
                            "title": "قنادی و شیرینی‌فروشی",
                            "slug": "confectionery-store"
                        },
                        {
                            "title": "فروشگاه نوشیدنی و قهوه",
                            "slug": "beverage-coffee-store"
                        }
                    ]
                },

                {
                    "title": "مصرف‌کنندگان و خریداران تجاری",
                    "slug": "business-buyers",
                    "children": [
                        {
                            "title": "رستوران و غذاخوری",
                            "slug": "restaurant"
                        },
                        {
                            "title": "کافه و کافی‌شاپ",
                            "slug": "cafe"
                        },
                        {
                            "title": "کترینگ و تهیه غذا",
                            "slug": "catering"
                        },
                        {
                            "title": "هتل و مجموعه اقامتی",
                            "slug": "hotel"
                        },
                        {
                            "title": "آشپزخانه صنعتی",
                            "slug": "commercial-kitchen"
                        },
                        {
                            "title": "مجموعه و سازمان مصرف‌کننده",
                            "slug": "institutional-food-buyer"
                        },
                        {
                            "title": "فروشگاه و کسب‌وکار خریدار مواد غذایی",
                            "slug": "business-food-buyer"
                        }
                    ]
                },

                {
                    "title": "بسته‌بندی و آماده‌سازی",
                    "slug": "packing-preparation",
                    "children": [
                        {
                            "title": "واحد سورت و بسته‌بندی",
                            "slug": "sorting-packing-unit"
                        },
                        {
                            "title": "بسته‌بندی‌کننده محصولات غذایی",
                            "slug": "food-packer"
                        },
                        {
                            "title": "بسته‌بندی قراردادی مواد غذایی",
                            "slug": "contract-food-packer"
                        },
                        {
                            "title": "لیبل و آماده‌سازی محصول",
                            "slug": "product-preparation"
                        }
                    ]
                },

                {
                    "title": "نگهداری و زنجیره تأمین",
                    "slug": "storage-supply-chain",
                    "children": [
                        {
                            "title": "سردخانه",
                            "slug": "cold-storage"
                        },
                        {
                            "title": "انبار مواد غذایی",
                            "slug": "food-warehouse"
                        },
                        {
                            "title": "مرکز توزیع",
                            "slug": "distribution-center"
                        },
                        {
                            "title": "خدمات لجستیک مواد غذایی",
                            "slug": "food-logistics"
                        },
                        {
                            "title": "حمل و نگهداری محصولات غذایی",
                            "slug": "food-transport"
                        }
                    ]
                },

                {
                    "title": "واسطه‌گری و بازار",
                    "slug": "intermediation",
                    "children": [
                        {
                            "title": "واسطه مواد غذایی",
                            "slug": "food-broker"
                        },
                        {
                            "title": "کارگزار خرید و فروش مواد غذایی",
                            "slug": "food-trade-broker"
                        },
                        {
                            "title": "نماینده تجاری",
                            "slug": "food-trade-agent"
                        },
                        {
                            "title": "بازاریاب و فروشنده تجاری",
                            "slug": "food-sales-marketer"
                        }
                    ]
                }
            ]
        },
        {
            "title": "سایر صنایع و فعالیت‌های تجاری",
            "slug": "other-business-activities",
            "children": [
                {
                    "title": "صنایع و فعالیت‌های تخصصی",
                    "slug": "specialized-industries"
                },
                {
                    "title": "فعالیت‌های چندحوزه‌ای",
                    "slug": "multi-sector-businesses"
                }
            ]
        }
    ]
}