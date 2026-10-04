# Prayer Times Admin Dashboard

Prayer Times অ্যাপের জন্য Node.js + Express ভিত্তিক একটি server-rendered admin console। এটি browser-side Firebase Web SDK ব্যবহার করে না। Firebase Admin SDK এবং local `service-account.json` দিয়ে Firestore ও FCM access করে।

## Features

- Dashboard overview ও device analytics
- নিবন্ধিত সব ডিভাইস/single-device FCM notification এবং delivery history
- Islamic event CRUD
- App update policy ও promotional notice
- Bank/mobile payment method CRUD
- Qur’an reciter catalogue CRUD
- Supporter goal, stats ও verified purchase overview
- Light/dark theme এবং responsive layout

## Local setup

1. Firebase Console → Project settings → Service accounts → Firebase Admin SDK থেকে private key তৈরি করুন।
2. Download করা JSON file-টি project root-এ `service-account.json` নামে রাখুন। এই file Git দ্বারা ignore করা আছে।
3. `.env.example` কপি করে `.env` বানিয়ে প্রয়োজনমতো admin username/password দিন।
4. Run করুন:

   ```bash
   npm install
   npm start
   ```

5. Google Chrome-এ `http://127.0.0.1:3000` খুলুন।

Development-এ credentials না দিলে dashboard শুধু loopback/localhost request গ্রহণ করে। Production-এ `DASHBOARD_USERNAME` এবং `DASHBOARD_PASSWORD` বাধ্যতামূলক।

`service-account.json` না থাকলে সার্ভার Application Default Credentials ব্যবহার করে। সে ক্ষেত্রে `gcloud auth application-default login` চালিয়ে এই Firebase project-এর অনুমোদিত account দিয়ে login করুন। `invalid_grant` দেখালে আবার login করে সার্ভার restart করুন।

## Notification tracking

এই dashboard-এর `/api/notifications/send` থেকেই campaign ও প্রতি recipient-এর গোপন receipt তৈরি হয়, তারপর FCM-এ পাঠানো হয়। সব ডিভাইসের ক্ষেত্রে `device_tokens`-এর unique token-গুলোতে সর্বোচ্চ ৫০০টি করে batch পাঠানো হয়। Topic-এর বদলে recipient অনুযায়ী পাঠানোর কারণে প্রতিটি payload-এ আলাদা tracking token দেওয়া যায়।

Flutter app received/opened event পাঠায়। `prayer_times/functions`-এর `trackNotificationEvent` callable receipt যাচাই করে একই Firebase project-এর `notification_logs/{campaignId}` counter আপডেট করে। Dashboard সেই counter থেকে report দেখায়। আলাদা CLI sender প্রয়োজন নেই।

Dashboard চালাতে এই project-এর `npm start`; callable backend deploy করতে `prayer_times` project থেকে `firebase deploy --only functions:trackNotificationEvent --project prayer-times-6163f` ব্যবহার করুন। Dashboard-এর পুরোনো `functions/src/index.ts` sender বর্তমান Express UI ব্যবহার করে না।

Sender contract যাচাই করুন `npm run check:notifications` দিয়ে। এই যাচাইতে Firestore ও FCM mock করা হয়; কোনো বাস্তব notification পাঠানো হয় না।

## Security

- `service-account.json`, `.env`, service-account variants এবং generated metadata Git-এ যাবে না।
- Admin credential কখনো frontend JavaScript-এ পাঠানো হয় না।
- Public Flutter app-এর `firestore.rules` পরিবর্তন করা হয় না; server-side Admin SDK আলাদা trusted boundary হিসেবে কাজ করে।
- Production deploy-এর সময় HTTPS reverse proxy ব্যবহার করুন।
