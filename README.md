<div align="center">

# 🏜️ النجاة في الصحراء

### Desert Survival 3D

لعبة مغامرات ثلاثية الأبعاد - اجتز الصحراء القاسية وصل للمخيم قبل نفاذ الوقود!

[![GitHub Pages](https://img.shields.io/badge/GitHub-Pages-222222?style=for-the-badge&logo=github)](https://abosalehg-ui.github.io/survival-skills3D/)
[![Three.js](https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=three.js&logoColor=white)](https://threejs.org/)
[![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/HTML)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

[🎮 العب الآن](https://abosalehg-ui.github.io/survival-skills3D/) · [📝 الإبلاغ عن مشكلة](https://github.com/abosalehg-ui/survival-skills3D/issues)

<img src="https://img.shields.io/badge/🚙_قيادة-FFD700?style=flat-square" alt="قيادة">
<img src="https://img.shields.io/badge/⛽_وقود-FF4500?style=flat-square" alt="وقود">
<img src="https://img.shields.io/badge/🏕️_نجاة-228B22?style=flat-square" alt="نجاة">

</div>

---

## 🎯 فكرة اللعبة

أنت عالق في صحراء شاسعة مع سيارتك ووقود محدود. هدفك هو الوصول إلى **المخيم الصحراوي** قبل نفاذ الوقود! اجمع الوقود من محطات البنزين على طريقك، وتجنب العقبات، واجتز المراحل الصعبة لتصبح **ناجياً حقيقياً**!

## ✨ المميزات

| الميزة | الوصف |
|--------|-------|
| 🎮 **رسومات 3D** | بيئة ثلاثية الأبعاد غامرة باستخدام Three.js |
| 🎯 **3 أوضاع لعب** | القصة (6 مراحل)، سباق الوقت، والتحدي اللانهائي |
| 🚗 **4 مركبات** | شاص، جيب قديم، بيك-أب، وشاحنة صغيرة — لكلٍّ خصائصه |
| 📱 **تحكم سهل** | سحب/أزرار على الجوال، أسهم أو WASD على الحاسوب |
| ⛽ **وقود وصحة وقدرات** | علب وقود، تعزيز سرعة، درع، ومضاعف وقود |
| 🌪 **عواصف رملية** | طقس ديناميكي يقيّد الرؤية والتوجيه |
| 🏅 **إنجازات وأرقام قياسية** | 10 إنجازات وأفضل الأزمنة/المسافات تُحفظ محلياً |
| 📲 **PWA دون اتصال** | ثبّتها كتطبيق والعب بلا إنترنت |
| 🌐 **واجهة عربية** | تجربة لعب كاملة باللغة العربية |

## 🕹️ طريقة اللعب

```
┌─────────────────────────────────────────┐
│                                         │
│   👆 اسحب يميناً ويساراً للتحكم        │
│                                         │
│   ⛽ اجمع الوقود من المحطات            │
│                                         │
│   🏕️ صل للمخيم قبل نفاذ الوقود        │
│                                         │
└─────────────────────────────────────────┘
```

### التحكم:
- **📱 على الجوال:** اسحب بإصبعك يميناً أو يساراً
- **💻 على الحاسوب:** استخدم الماوس للسحب أو أسهم لوحة المفاتيح

### نصائح للفوز:
1. 🎯 حافظ على مسار مستقيم قدر الإمكان
2. ⛽ لا تفوّت أي محطة وقود
3. 👀 راقب شريط الوقود باستمرار
4. 🏃 تقدم بسرعة لكن بحذر

## 🚀 التشغيل

### الطريقة الأولى: اللعب مباشرة
```
https://abosalehg-ui.github.io/survival-skills3D/
```

### الطريقة الثانية: التشغيل المحلي
```bash
# استنساخ المستودع
git clone https://github.com/abosalehg-ui/survival-skills3D.git

# الانتقال للمجلد
cd survival-skills3D

# فتح اللعبة في المتصفح
open index.html
# أو على Windows
start index.html
```

> ⚠️ **ملاحظة:** قد تحتاج لتشغيل خادم محلي لتعمل مكتبة Three.js بشكل صحيح:
> ```bash
> # باستخدام Python
> python -m http.server 8000
> 
> # ثم افتح في المتصفح
> http://localhost:8000
> ```

## 🛠️ التقنيات المستخدمة

| التقنية | الاستخدام |
|---------|-----------|
| **Three.js** | محرك الرسومات ثلاثية الأبعاد |
| **HTML5** | هيكلة الصفحة |
| **CSS3** | التصميم والحركات |
| **JavaScript** | منطق اللعبة والتفاعل |
| **GitHub Pages** | الاستضافة |

## 📁 هيكل المشروع

```
survival-skills3D/
├── index.html              # اللعبة كاملة في ملف واحد (كل الرسوميات إجرائية تقريباً — استثناء وحيد أدناه)
├── service-worker.js       # التخزين المؤقت للعمل دون اتصال (PWA)
├── manifest.webmanifest    # بيانات تثبيت التطبيق (PWA)
├── assets/models/          # استثناء وحيد: نموذج الجمل (camel.glb) — اختياري، محلي
├── icons/                  # أيقونات التطبيق
├── docs/                   # خطط التطوير والمراجعات الهندسية
└── README.md               # ملف التوثيق
```

> 🧱 **قاعدة معمارية**: كل الرسوميات والمؤثرات تُولَّد برمجياً وقت التشغيل (Canvas/WebAudio)
> بلا نماذج GLB أو صور خامات أو ملفات صوت — **باستثناء وحيد معتمد**: نموذج الجمل
> (`assets/models/camel.glb`، محلي من نفس الأصل لا CDN خارجي). يُحمَّل بشكل غير معطِّل
> ويبقى الجمل الإجرائي احتياطياً دائماً إن غاب الملف، فتعمل اللعبة دون اتصال بالكامل في
> كل الأحوال (بجمل إجرائي بدل النموذج فقط إن لم يُخزَّن الملف مسبقاً).

## 🎨 لقطات من اللعبة

<div align="center">

| شاشة البداية | أثناء اللعب | الفوز |
|:------------:|:-----------:|:-----:|
| 🏜️ انطلق في المغامرة | 🚙 قُد بحذر | 🏆 وصلت بسلام! |

</div>

## 🔮 التطويرات المستقبلية

- [ ] 🎵 إضافة مؤثرات صوتية
- [ ] 🌪️ عوائق إضافية (عواصف رملية)
- [ ] 🏅 نظام النقاط والأرقام القياسية
- [ ] 🚗 سيارات متعددة للاختيار
- [ ] 🗺️ خرائط ومراحل جديدة
- [ ] 🌙 وضع الليل

## 🤝 المساهمة

المساهمات مرحب بها! إذا كانت لديك أفكار لتحسين اللعبة:

1. اعمل Fork للمستودع
2. أنشئ فرعاً جديداً (`git checkout -b feature/ميزة-جديدة`)
3. نفّذ التغييرات (`git commit -m 'إضافة ميزة رائعة'`)
4. ارفع التغييرات (`git push origin feature/ميزة-جديدة`)
5. افتح Pull Request

## 📄 الترخيص

هذا المشروع متاح للاستخدام الحر والتعليمي.

## 👨‍💻 المطور

<div align="center">

**عبدالكريم العبود**

[![Email](https://img.shields.io/badge/Email-abo.saleh.g%40gmail.com-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:abo.saleh.g@gmail.com)
[![GitHub](https://img.shields.io/badge/GitHub-abosalehg--ui-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/abosalehg-ui)

</div>

---

<div align="center">

### 🏜️ هل أنت مستعد للتحدي؟

[🎮 ابدأ اللعب الآن!](https://abosalehg-ui.github.io/survival-skills3D/)

صُنع بـ ❤️ و ☕

</div>
