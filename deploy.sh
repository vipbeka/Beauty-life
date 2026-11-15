#!/usr/bin/env bash
# ============================================================
# Beauty Life — نشر نضيف: مسح النسخة القديمة + سحب الجديدة من GitHub + Firebase Deploy
# الاستخدام:  bash deploy.sh
# ============================================================
set -euo pipefail

# ---------- عدّل السطرين دول بس ----------
REPO="https://github.com/devbnds/Test.git"   # ← ضع رابط ريبو الجيت هاب بتاعك
BRANCH="main"                                  # ← اسم الفرع (main أو master)
PROJECT="beautylife1-890ae"                    # ← معرّف مشروع Firebase
WORKDIR="$HOME/beautylife-deploy-tmp"
# -----------------------------------------

echo "==> [1/6] التأكد من الأدوات المطلوبة"
command -v git >/dev/null || { echo "❌ git غير مثبت"; exit 1; }
command -v firebase >/dev/null || {
  echo "⚠️  firebase-tools غير مثبت — بيتم تثبيته الآن"
  npm install -g firebase-tools
}

echo "==> [2/6] مسح النسخة القديمة بالكامل من الجهاز"
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"

echo "==> [3/6] سحب أحدث نسخة من GitHub ($BRANCH)"
git clone --depth 1 --branch "$BRANCH" "$REPO" "$WORKDIR/site"
cd "$WORKDIR/site"

echo "    آخر كوميت:"
git --no-pager log -1 --pretty='    %h  %an  %ad%n    %s' --date=short

echo "==> [4/6] تركيب firebase.json الصحيح (منع كاش الـ JS/CSS/HTML)"
if [ -f "$HOME/beautylife-deploy/firebase.json" ]; then
  cp "$HOME/beautylife-deploy/firebase.json" ./firebase.json
  echo "    ✅ تم نسخ firebase.json المعدّل"
else
  echo "    ⚠️  لم أجد firebase.json المعدّل — سيتم استخدام الموجود في الريبو"
fi
echo "$PROJECT" > .firebase-project
printf '{\n  "projects": {\n    "default": "%s"\n  }\n}\n' "$PROJECT" > .firebaserc

echo "==> [5/6] تسجيل الدخول والنشر"
firebase login --no-localhost || true
# النشر في Firebase Hosting يستبدل الموقع بالكامل — الملفات القديمة تُحذف تلقائيًا من السيرفر
firebase deploy --only hosting --project "$PROJECT" --force

echo "==> [6/6] التحقق أن الملف الجديد فعلًا على السيرفر"
sleep 3
STAMP=$(date +%s)
echo "    --- ترويسات js/app.js ---"
curl -sI "https://${PROJECT}.web.app/js/app.js?v=$STAMP" \
  | grep -iE '^HTTP|cache-control|content-length|last-modified' || true

echo "    --- فحص أن التحويل المدفوع (render/image) لم يعد موجودًا ---"
if curl -s "https://${PROJECT}.web.app/js/app.js?v=$STAMP" | grep -q 'render/image'; then
  echo "    ❌ لسه فيه render/image — الملف المرفوع مش المعدّل"
else
  echo "    ✅ نضيف: مفيش render/image"
fi

echo
echo "🎉 تم النشر. لو لسه شايف القديم على موبايلك:"
echo "   افتح https://${PROJECT}.web.app/?v=$STAMP"
echo "   أو امسح كاش المتصفح (Ctrl+Shift+R على الكمبيوتر)."
