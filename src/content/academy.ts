// ===== Matjar Academy — guide content =====
// In-repo, version-controlled guide content (no CMS yet — deliberately light).
// Language: Modern Standard Arabic (فصحى) — the Academy reads as a professional,
// authoritative resource, distinct from the app's friendly Lebanese UI voice.
// Adding a guide = one entry here.

import type { LucideIcon } from "lucide-react";
import type { FeatureStatus } from "@/lib/feature-availability";
import {
  Megaphone,
  ShoppingBag,
  Calculator,
  HeartHandshake,
  Camera,
  Share2,
  ClipboardList,
  TrendingUp,
} from "lucide-react";

export type GuideBlock =
  | { t: "p"; text: string }
  | { t: "h"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "tip"; text: string };

export type AcademyCategory =
  | "marketing"
  | "ecommerce"
  | "accounting"
  | "service"
  | "branding"
  | "social"
  | "management"
  | "growth";

// Display order. accounting is kept in the type but not surfaced (no guides yet).
// management + growth are listed before they have guides: their state is NOT
// written here — it is derived from the guide count by academyCategoryStatus()
// and printed with the registry's one word for it (featureCopy), so a category
// that gains its first guide stops reading as pending without an edit here.
export const ACADEMY_CATEGORIES: AcademyCategory[] = [
  "marketing",
  "ecommerce",
  "service",
  "branding",
  "social",
  "management",
  "growth",
];

/** A category's availability in the vocabulary of the feature registry: it is
 *  `available` the moment one guide exists under it and `coming_soon` until
 *  then. Content supply, resolved the same way section-supply.ts resolves a
 *  vertical — never a flag someone has to remember to flip. */
export function academyCategoryStatus(guideCount: number): FeatureStatus {
  return guideCount > 0 ? "available" : "coming_soon";
}

// Line icon per category (lucide — minimal, single-color; no emoji).
export const CATEGORY_ICON: Record<AcademyCategory, LucideIcon> = {
  marketing: Megaphone,
  ecommerce: ShoppingBag,
  accounting: Calculator,
  service: HeartHandshake,
  branding: Camera,
  social: Share2,
  management: ClipboardList,
  growth: TrendingUp,
};

// Per-category visual identity (literal class strings so Tailwind keeps them).
// tint = icon badge, text = accent text, bar = solid accent, grad = header wash.
//
// Each track sits on one slot of the shared categorical ramp in globals.css
// (--tint-1 … --tint-7) instead of its own hand-picked hue: seven slots plus
// growth on the brand blue covers the eight tracks exactly. The old `dark:`
// overrides are gone because the token already carries its dark value — that is
// the whole point of the ramp. See the comment above --tint-1 for why seven.
export const CATEGORY_STYLE: Record<
  AcademyCategory,
  { tint: string; text: string; bar: string; grad: string }
> = {
  marketing: {
    tint: "bg-tint-7-soft text-tint-7",
    text: "text-tint-7",
    bar: "bg-tint-7",
    grad: "from-tint-7/20",
  },
  ecommerce: {
    tint: "bg-tint-5-soft text-tint-5",
    text: "text-tint-5",
    bar: "bg-tint-5",
    grad: "from-tint-5/20",
  },
  accounting: {
    tint: "bg-tint-4-soft text-tint-4",
    text: "text-tint-4",
    bar: "bg-tint-4",
    grad: "from-tint-4/20",
  },
  service: {
    tint: "bg-tint-1-soft text-tint-1",
    text: "text-tint-1",
    bar: "bg-tint-1",
    grad: "from-tint-1/20",
  },
  branding: {
    tint: "bg-tint-2-soft text-tint-2",
    text: "text-tint-2",
    bar: "bg-tint-2",
    grad: "from-tint-2/20",
  },
  social: {
    tint: "bg-tint-3-soft text-tint-3",
    text: "text-tint-3",
    bar: "bg-tint-3",
    grad: "from-tint-3/20",
  },
  management: {
    tint: "bg-tint-6-soft text-tint-6",
    text: "text-tint-6",
    bar: "bg-tint-6",
    grad: "from-tint-6/20",
  },
  growth: {
    tint: "bg-primary-soft text-primary",
    text: "text-primary",
    bar: "bg-primary",
    grad: "from-primary/20",
  },
};

export type GuideLevel = "beginner" | "intermediate";

export type Guide = {
  slug: string;
  category: AcademyCategory;
  level: GuideLevel;
  title: string;
  titleEn: string;
  excerpt: string;
  readMin: number;
  emoji: string;
  blocks: GuideBlock[];
};

export const GUIDES: Guide[] = [
  {
    slug: "pricing-smart",
    category: "ecommerce",
    level: "intermediate",
    title: "كيف تُسعّر منتجاتك بذكاء",
    titleEn: "How to price your products smartly",
    excerpt: "التسعير الخاطئ يلتهم أرباحك بصمت. تعلّم كيف تحسب تكلفتك الحقيقيّة وتضع سعراً يحقّق لك ربحاً دون أن يُنفّر عميلك.",
    readMin: 6,
    emoji: "🏷️",
    blocks: [
      { t: "p", text: "أكثر خطأٍ يقع فيه صاحب المشروع الصغير أن يُسعّر «حسب السوق» أو «مثل منافسه» دون أن يعرف تكلفته الحقيقيّة؛ والنتيجة أن يبيع كثيراً ويربح قليلاً، أو أن يخسر وهو لا يدري." },
      { t: "h", text: "احسب تكلفتك الكاملة، لا سعر الشراء وحده" },
      { t: "p", text: "تكلفة المنتج ليست ما دفعته فيه فحسب، بل كلّ ما يُضاف إليه حتى يصل إلى العميل:" },
      { t: "ul", items: [
        "سعر الشراء أو تكلفة المواد",
        "الشحن والتوصيل والرسوم الجمركيّة",
        "التغليف",
        "حصّةٌ من مصاريف المتجر (كهرباء وإنترنت وإيجار) موزّعةٌ على المنتجات",
        "وقتك أنت؛ فساعة عملك لها ثمن",
      ]},
      { t: "h", text: "افهم الفرق بين هامش الربح ونسبة الزيادة" },
      { t: "p", text: "هامش الربح هو الربح كنسبةٍ من سعر البيع، أمّا نسبة الزيادة فهي الربح كنسبةٍ من التكلفة. منتجٌ تكلفته عشرةٌ وبِعته بخمسة عشر: نسبة الزيادة خمسون بالمئة، لكنّ الهامش ثلاثةٌ وثلاثون بالمئة فقط. وكثيرٌ من التجّار يخلطون بينهما فيُفاجَؤون بأنّ ربحهم أقلّ ممّا ظنّوا." },
      { t: "tip", text: "استعِن بحاسبة الأرباح وحاسبة التسعير في مركز الأدوات؛ فهما تحسبان لك الهامش ونسبة الزيادة والسعر المقترح في لحظة." },
      { t: "h", text: "سعّر وفق القيمة، لا التكلفة وحدها" },
      { t: "p", text: "إذا كان منتجك يحلّ مشكلةً، أو يوفّر وقتاً، أو يمنح إحساساً بالرقيّ، فإنّ العميل مستعدٌّ لأن يدفع أكثر. التكلفة تحدّد الحدّ الأدنى للسعر، أمّا القيمة فتحدّد إلى أيّ مدى يمكنك أن ترتفع فوقه." },
      { t: "h", text: "جرّب، ثمّ راقب" },
      { t: "p", text: "السعر ليس قراراً يُتّخذ مرّةً واحدة. جرّب سعراً لأسبوعين، وراقب كم بِعت وكم ربحت — لا كم بِعت فحسب — ثمّ عدّل. فأحياناً يقلّل رفعُ السعر عشرةً بالمئة المبيعاتِ خمسةً بالمئة فقط، فتربح أكثر بجهدٍ أقلّ." },
    ],
  },
  {
    slug: "whatsapp-marketing",
    category: "marketing",
    level: "beginner",
    title: "التسويق عبر واتساب لتجّار لبنان",
    titleEn: "WhatsApp marketing for Lebanese merchants",
    excerpt: "واتساب هو متجرك الحقيقي في لبنان. تعلّم كيف تستخدمه أداةَ مبيعاتٍ محترمة، لا مصدرَ إزعاج.",
    readMin: 7,
    emoji: "💬",
    blocks: [
      { t: "p", text: "في لبنان، ليس واتساب مجرّد تطبيقٍ للمراسلة، بل هو قناة البيع الأولى. غير أنّ الفارق بين تاجرٍ يبيع من خلاله وآخر يُزعج به عملاءه إنّما هو في الأسلوب." },
      { t: "h", text: "هيّئ رقمك: واتساب للأعمال" },
      { t: "ul", items: [
        "حمّل تطبيق «واتساب للأعمال» المجّاني؛ فهو يمنحك ملفّاً تعريفيّاً وكتالوجاً وردوداً جاهزة",
        "أدرِج اسم متجرك وساعات العمل والعنوان",
        "فعّل رسالة ترحيبٍ ورسالةً تلقائيّةً حين تكون مشغولاً",
      ]},
      { t: "h", text: "استأذن قبل أن تُرسل" },
      { t: "p", text: "لا تُرسل العروض إلى من لم يطلبها منك؛ فذلك يدفعهم إلى حظرك. بل اجعل العميل يبادر بأوّل رسالة: ضع زرّ واتساب على متجرك وحسابك في إنستغرام، وحين يراسلك استأذنه إن كان يرغب في أن تصله عروضك." },
      { t: "h", text: "الرسالة الجيّدة: موجزةٌ، شخصيّةٌ، ذات قيمة" },
      { t: "ol", items: [
        "ابدأ باسم العميل إن كنت تعرفه",
        "اذكر القيمة في السطر الأوّل: خصمٌ؟ منتجٌ جديد؟ وصول ما طلبه؟",
        "أرفق صورةً واحدةً واضحة، لا عشراً",
        "اختم بخطوةٍ واحدةٍ واضحة: «هل تحبّ أن أحجز لك؟»",
      ]},
      { t: "h", text: "اجمع أرقامك ونظّمها" },
      { t: "p", text: "عميلك الحاليّ أثمن من عميلٍ جديد. أنشئ مجموعاتٍ (عملاء دائمون، ومهتمّون بصنفٍ بعينه) وأرسل إلى كلٍّ منها ما يخصّها من العروض، لا الرسالة ذاتها إلى الجميع." },
      { t: "tip", text: "استخدم مولّد رابط واتساب ومولّد رمز QR في مركز الأدوات لإنشاء رابطٍ برسالةٍ جاهزة تضعه على منشوراتك وواجهة متجرك." },
      { t: "h", text: "تابِع، ولا تُلاحِق" },
      { t: "p", text: "إن لم يردّ العميل، فتذكيرٌ لطيفٌ واحدٌ بعد يومين يكفي؛ وما زاد على ذلك صار إزعاجاً. الاحترام يبني الثقة، والثقة تبيع أكثر من أيّ عرض." },
    ],
  },
  {
    slug: "product-photos-phone",
    category: "branding",
    level: "beginner",
    title: "صوّر منتجاتك بهاتفك باحترافيّة",
    titleEn: "Shoot pro product photos with your phone",
    excerpt: "لست بحاجةٍ إلى كاميرا باهظة. بضوء الشمس وخلفيّةٍ نظيفة وهاتفك، تحصل على صورٍ تبيع.",
    readMin: 5,
    emoji: "📸",
    blocks: [
      { t: "p", text: "الصورة أوّل ما يراه العميل، وغالباً آخر ما يبني عليه قراره. والخبر السارّ أنّ هاتفك اليوم يكفي تماماً؛ فالحيلة في الضوء والترتيب، لا في الكاميرا." },
      { t: "h", text: "الضوء الطبيعيّ حليفك" },
      { t: "ul", items: [
        "صوّر نهاراً قرب نافذة، على أن يأتي الضوء من الجانب لا من خلف المنتج",
        "تجنّب ضوء الفلاش؛ فهو يُحدث ظلالاً قاسيةً وألواناً غير حقيقيّة",
        "الغيم الخفيف يمنحك إضاءةً مثاليّة: ناعمةً وموزّعة",
      ]},
      { t: "h", text: "خلفيّةٌ نظيفةٌ وبسيطة" },
      { t: "p", text: "الخلفيّة البيضاء أو ذات اللون الواحد الهادئ تجعل المنتج هو البطل. تكفي ورقةٌ بيضاء أو قماشةٌ نظيفة؛ وأزِل كلّ ما هو مبعثرٌ من الإطار." },
      { t: "h", text: "زوايا متعدّدة" },
      { t: "ol", items: [
        "صورةٌ أماميّةٌ واضحة",
        "صورةٌ من الأعلى، لا سيّما للطعام والإكسسوارات",
        "لقطةٌ قريبةٌ للتفاصيل: الخامة والحياكة والمكوّنات",
        "المنتج أثناء استعماله؛ فذلك يعين العميل على تخيّله",
      ]},
      { t: "tip", text: "استخدم مزيل الخلفيّة ومحسّن الصور متى توفّرا في مركز الأدوات للحصول على صورٍ نظيفةٍ بضغطة." },
      { t: "h", text: "ثبّت واضبط" },
      { t: "p", text: "ثبّت الهاتف، ونظّف العدسة، وحافظ على الإضاءة والزاوية نفسها في جميع صورك، حتى يكتسب متجرك مظهراً موحّداً واحترافيّاً." },
    ],
  },
  {
    slug: "product-description",
    category: "ecommerce",
    level: "intermediate",
    title: "اكتب وصف منتجٍ يبيع",
    titleEn: "Write a product description that sells",
    excerpt: "الوصف الجيّد ليس قائمةَ مواصفات، بل إجابةٌ عن سؤال العميل: بماذا سيفيدني هذا المنتج؟",
    readMin: 5,
    emoji: "✍️",
    blocks: [
      { t: "p", text: "أكثر الأوصاف مملّةٌ لأنّها تتحدّث عن المنتج لا عن العميل. لا يعني العميلَ أنّ القماش قطنٌ خالص، بل يعنيه أنّه سيكون مرتاحاً ولن يتصبّب عرقاً في صيف بيروت." },
      { t: "h", text: "حوّل الميزة إلى منفعة" },
      { t: "ul", items: [
        "ميزة: بطاريّةٌ بسعة خمسة آلاف مِلّي أمبير ← منفعة: تعمل يومين دون إعادة شحن",
        "ميزة: مقاومٌ للماء ← منفعة: لا تقلق عليه في المطر أو على شاطئ البحر",
        "ميزة: صناعةٌ يدويّة ← منفعة: قطعةٌ فريدةٌ لا يملك أحدٌ سواك مثلها",
      ]},
      { t: "h", text: "ابدأ بالأقوى" },
      { t: "p", text: "السطر الأوّل يحسم ما إذا كان العميل سيُكمل القراءة. ضع أهمّ منفعةٍ أو أبرز ما يميّز المنتج في البداية، لا في النهاية." },
      { t: "h", text: "اكتب كما تتحدّث" },
      { t: "p", text: "بلغةٍ بسيطةٍ وقريبة، كأنّك تشرح لصديق. أمّا الكلام الرسميّ الجامد فيُنفّر. اجعل الجملة قصيرةً والكلمة واضحة." },
      { t: "h", text: "أجِب عن الاعتراضات قبل أن تُسأل" },
      { t: "ol", items: [
        "المقاس؟ أدرِج جدولاً واضحاً",
        "التوصيل؟ اذكر مدّته والمناطق التي تصلها",
        "الضمان أو الإرجاع؟ طَمئِن العميل",
      ]},
      { t: "tip", text: "اجعل بيانات متجرك ثنائيّة اللغة (عربيّة وإنجليزيّة) على متجر؛ فذلك يوسّع جمهورك ويحسّن ظهورك في نتائج البحث." },
    ],
  },
  {
    slug: "customer-service",
    category: "service",
    level: "beginner",
    title: "خدمة العملاء: من عميلٍ غاضبٍ إلى عميلٍ وفيّ",
    titleEn: "Customer service: from angry to loyal",
    excerpt: "الشكوى فرصةٌ لا تهديد. تعرّف كيف تعالج المشكلات بأسلوبٍ يجعل العميل يعود ويثني عليك.",
    readMin: 6,
    emoji: "🤝",
    blocks: [
      { t: "p", text: "كلّ تاجرٍ يواجه عميلاً غاضباً. والفارق أنّ العميل الذي تُحلّ مشكلته بسرعةٍ واحترامٍ يصير أوفى من عميلٍ لم يواجه مشكلةً أصلاً؛ فالأزمة فرصةٌ لتُثبت أنّك أهلٌ للثقة." },
      { t: "h", text: "أنصِت قبل أن تدافع" },
      { t: "p", text: "أوّل ردّة فعلٍ خاطئة أن تشرح لماذا أنت على حقّ. العميل يريد أن يشعر بأنّك سمعته؛ فابدأ بعبارة «فهمتك، ومن حقّك أن تنزعج»، فهي تُطفئ أكثر الغضب." },
      { t: "h", text: "اعتذر بصدق، دون أعذار" },
      { t: "p", text: "عبارة «أعتذر عمّا حدث معك» أقوى بكثيرٍ من «لكنّ هذا ليس خطئي». لا يعني العميلَ من المخطئ، بل يعنيه الحلّ." },
      { t: "h", text: "احلُل، وزِد قليلاً" },
      { t: "ol", items: [
        "قدّم حلّاً واضحاً وسريعاً: استبدالاً، أو إرجاعاً، أو تعويضاً",
        "إن استطعت، أضِف شيئاً صغيراً غير متوقّع: خصماً على الطلب القادم، أو هديّةً بسيطة",
        "تابِع بعد الحلّ لتطمئنّ إلى أنّ العميل قد ارتاح",
      ]},
      { t: "h", text: "تعلّم من الشكوى" },
      { t: "p", text: "إن تكرّرت المشكلة نفسها، فليس ذلك سوء حظّ، بل إشارةٌ إلى أنّ عليك إصلاح شيءٍ في منتجك أو في طريقة عملك. سجّل الشكاوى وابحث عن النمط المتكرّر." },
      { t: "tip", text: "سرعة الردّ تصنع فارقاً. فعّل الإشعارات في تطبيق التاجر كي لا تتأخّر عن رسالة عميل؛ فالتأخير يُضخّم المشكلة." },
    ],
  },
  {
    slug: "instagram-basics",
    category: "social",
    level: "beginner",
    title: "ابنِ حضورك على إنستغرام من الصفر",
    titleEn: "Build your Instagram presence from zero",
    excerpt: "لا تحتاج إلى آلاف المتابعين، بل إلى المتابعين المناسبين. تعرّف كيف تبني حساباً يجلب لك عملاء حقيقيّين.",
    readMin: 7,
    emoji: "📱",
    blocks: [
      { t: "p", text: "يركض كثيرٌ من التجّار خلف عدد المتابعين. غير أنّ ألف متابعٍ من منطقتك ومهتمّين بمنتجك أثمن من مئة ألفٍ لن يشتروا أبداً؛ فالغاية مبيعاتٌ لا أرقام." },
      { t: "h", text: "رتّب ملفّك أوّلاً" },
      { t: "ul", items: [
        "اسمٌ واضح، ووصفٌ يبيّن ما تبيعه والمناطق التي تصلها",
        "رابط متجرك على متجر في نبذتك التعريفيّة",
        "زرّ تواصلٍ عبر واتساب مفعّلٌ من خلال حساب الأعمال المجّاني",
        "صورةٌ للملف: شعارك واضحاً",
      ]},
      { t: "h", text: "انشر بانتظام، لا بكثرة" },
      { t: "p", text: "ثلاثة إلى أربعة منشوراتٍ أسبوعيّاً بجودةٍ جيّدة خيرٌ من منشورٍ كلّ يومٍ بلا معنى. الانتظام يبني الثقة، والجودة تبني الرغبة." },
      { t: "h", text: "نوّع المحتوى" },
      { t: "ol", items: [
        "منتجاتٌ، لكن ليس كلّه بيعاً؛ فالناس تملّ",
        "ما وراء الكواليس: كيف تصنع، ومن أنت",
        "عملاءُ سعداءُ وآراؤهم؛ فهي أقوى إعلان",
        "نصائحُ أو معلوماتٌ تخصّ مجالك",
      ]},
      { t: "h", text: "المقاطع القصيرة والقصص أولويّة" },
      { t: "p", text: "يمنح إنستغرام اليوم وصولاً أوسع للمقاطع القصيرة والقصص. فمقطعٌ من خمس عشرة ثانيةً بهاتفك يصل إلى أناسٍ أكثر بكثيرٍ من صورة." },
      { t: "h", text: "تفاعل، ولا تنتظر" },
      { t: "p", text: "ردّ على كلّ تعليقٍ ورسالةٍ بسرعة، وتابِع حسابات منطقتك وتفاعل معها بصدق؛ فالحضور يُبنى بالعلاقات، لا بالنشر وحده." },
      { t: "tip", text: "استخدم مولّد رمز QR لإنشاء رمزٍ يوصل مباشرةً إلى حسابك أو متجرك، وضعه على واجهة المحلّ والبطاقات والأكياس." },
    ],
  },
];

// ===== Learning paths (curated sequences) =====
export type LearningPath = {
  slug: string;
  Icon: LucideIcon;
  category: AcademyCategory;
  title: string;
  titleEn: string;
  lessons: { ar: string; en: string }[];
};

export const LEARNING_PATHS: LearningPath[] = [
  {
    slug: "start",
    Icon: ShoppingBag,
    category: "ecommerce",
    title: "ابدأ متجرك من الصفر",
    titleEn: "Start your store from scratch",
    lessons: [
      { ar: "جهّز فكرتك وهويّتك", en: "Prepare your idea & identity" },
      { ar: "صوّر منتجاتك", en: "Photograph your products" },
      { ar: "اكتب أوصافاً تبيع", en: "Write descriptions that sell" },
      { ar: "سعّر بذكاء", en: "Price smartly" },
    ],
  },
  {
    slug: "sales",
    Icon: TrendingUp,
    category: "growth",
    title: "حسّن مبيعاتك",
    titleEn: "Improve your sales",
    lessons: [
      { ar: "التسعير الذكيّ", en: "Smart pricing" },
      { ar: "عروض واتساب الفعّالة", en: "Effective WhatsApp offers" },
      { ar: "استعادة السلال المتروكة", en: "Recover abandoned carts" },
    ],
  },
  {
    slug: "social",
    Icon: Share2,
    category: "social",
    title: "ابنِ حضورك على السوشال",
    titleEn: "Build your social presence",
    lessons: [
      { ar: "رتّب ملفّك", en: "Set up your profile" },
      { ar: "خطّة محتوى بسيطة", en: "A simple content plan" },
      { ar: "الريلز والقصص", en: "Reels & stories" },
      { ar: "تفاعلٌ يبني ولاء", en: "Engagement that builds loyalty" },
    ],
  },
  {
    slug: "service",
    Icon: HeartHandshake,
    category: "service",
    title: "طوّر خدمة الزبائن",
    titleEn: "Improve customer service",
    lessons: [
      { ar: "الردّ السريع والمحترم", en: "Fast, respectful replies" },
      { ar: "إدارة الشكاوى", en: "Handling complaints" },
      { ar: "تحويل الغاضب إلى وفيّ", en: "Turn angry into loyal" },
    ],
  },
];

// ===== "What do you want to improve today?" — topic → guide slugs =====
export type RecommendTopic =
  | "sales"
  | "pricing"
  | "photos"
  | "whatsapp"
  | "service"
  | "instagram";

export const RECOMMEND_TOPICS: RecommendTopic[] = [
  "sales",
  "pricing",
  "photos",
  "whatsapp",
  "service",
  "instagram",
];

export const RECOMMEND_MAP: Record<RecommendTopic, string[]> = {
  sales: ["pricing-smart", "whatsapp-marketing", "product-description"],
  pricing: ["pricing-smart"],
  photos: ["product-photos-phone"],
  whatsapp: ["whatsapp-marketing"],
  service: ["customer-service"],
  instagram: ["instagram-basics"],
};

export function guidesByCategory(cat: AcademyCategory): Guide[] {
  return GUIDES.filter((g) => g.category === cat);
}

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
