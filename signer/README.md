# Misr Motors e-invoice signer / برنامج توقيع الفواتير الإلكترونية

## English

**What it is.** A small program for the accountant's Windows PC. It uses the company's USB token (the e-seal) to sign
invoices waiting in the ERP, and sends the signatures back. The PIN never leaves the PC and is never saved.

**Install (once)**
1. Install the token's driver and plug the USB token in. Check that Windows shows the company certificate (it is issued to tax number 100060455).
2. Copy `MisrMotorsSigner.exe` to a folder such as `C:\MisrMotorsSigner`. Double-click it. A round icon appears near the clock (green = connected, red = problem).
3. Right-click the icon and tick "Start with Windows".

**Pairing (once)**
1. In the ERP, the CEO or admin opens E-invoice settings and presses "Connect a signer". The key is shown once - copy it.
2. In the signer, a window asks for the ERP address and the key. Paste both and press Connect. The key is stored for your Windows user only, protected by Windows. Pairing a new signer disconnects the old one.

**Every morning.** When the program starts, Windows or the token driver asks for the token PIN. Type it once. The token stays unlocked while the program runs and locks when the PC is turned off. Waiting invoices are then signed by themselves. If the driver asks for the PIN on every signature, right-click the icon and choose "Enter PIN / sign now": one prompt signs everything waiting.

**Troubleshooting**
- Red icon, "Cannot reach the ERP": no internet or the ERP is down. Nothing is lost; invoices wait and are signed when it is back.
- "N invoices waiting - enter PIN to sign": the token is locked or the PIN was cancelled. Right-click the icon, choose "Enter PIN / sign now".
- "Certificate not found" / wrong certificate: the token is not plugged in, or it holds only other certificates. Only the certificate issued to the company's tax number is used.
- "Does not accept this signer key": the signer was disconnected or replaced in the ERP. Press Connect again with a new key.
- The log is in the menu ("Open log").

## العربية

**ما هو.** برنامج صغير يعمل على جهاز المحاسب (ويندوز). يستخدم التوكن (الختم الإلكتروني للشركة) لتوقيع الفواتير المنتظرة في النظام ثم يرسل التوقيعات للنظام. الرقم السري لا يغادر الجهاز ولا يُحفظ.

**التثبيت (مرة واحدة)**
1. ثبّت تعريف التوكن ووصّله بالجهاز، وتأكد أن ويندوز يعرض شهادة الشركة (الرقم الضريبي 100060455).
2. انسخ `MisrMotorsSigner.exe` إلى مجلد مثل `C:\MisrMotorsSigner` وشغّله. ستظهر أيقونة دائرية بجوار الساعة (خضراء = متصل، حمراء = مشكلة).
3. انقر بالزر الأيمن على الأيقونة وفعّل "Start with Windows".

**الربط (مرة واحدة)**
1. في النظام يفتح المدير أو الرئيس التنفيذي إعدادات الفاتورة الإلكترونية ويضغط "Connect a signer". يظهر المفتاح مرة واحدة فقط - انسخه.
2. في البرنامج ستظهر نافذة: الصق عنوان النظام والمفتاح واضغط Connect. يُحفظ المفتاح لمستخدم ويندوز الحالي فقط ومحميًا بواسطة ويندوز. ربط برنامج جديد يفصل القديم.

**كل صباح.** عند تشغيل البرنامج يطلب ويندوز أو تعريف التوكن الرقم السري. اكتبه مرة واحدة. يبقى التوكن مفتوحًا أثناء عمل البرنامج ويُغلق عند إطفاء الجهاز، وتُوقَّع الفواتير المنتظرة تلقائيًا. إذا طلب التعريف الرقم السري مع كل توقيع، انقر بالزر الأيمن واختر "Enter PIN / sign now" فيوقّع كل المنتظر بطلب واحد.

**حل المشاكل**
- أيقونة حمراء "Cannot reach the ERP": لا يوجد إنترنت أو النظام متوقف. لا شيء يضيع؛ الفواتير تنتظر وتُوقَّع عند عودة الاتصال.
- "invoices waiting - enter PIN to sign": التوكن مغلق أو أُلغي إدخال الرقم السري. اختر "Enter PIN / sign now".
- شهادة غير موجودة / شهادة خاطئة: التوكن غير موصول أو لا يحتوي إلا شهادات أخرى. تُستخدم فقط شهادة الرقم الضريبي للشركة.
- "does not accept this signer key": تم فصل البرنامج أو استبداله في النظام. اربطه من جديد بمفتاح جديد.
- السجل متاح من القائمة ("Open log").
