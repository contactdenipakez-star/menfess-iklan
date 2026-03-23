require("dotenv").config();
const { Telegraf } = require("telegraf");
const fs = require("fs-extra");

const bot = new Telegraf(process.env.BOT_TOKEN);
const dbFile = "database.json";

function loadDB() {
  return fs.readJsonSync(dbFile);
}

function saveDB(data) {
  fs.writeJsonSync(dbFile, data, { spaces: 2 });
}

const allowedTags = [
  "#jual",
  "#beli",
  "#cewejomblo",
  "#cowojomblo",
  "#cari"
];

function isCooldown(userId, db) {
  if (!db.cooldown[userId]) return false;
  const now = Date.now();
  return now - db.cooldown[userId] < process.env.COOLDOWN;
}

bot.start((ctx) => {
  ctx.reply(
`👋 Selamat datang di *Menfess Iklan*

📢 FORMAT WAJIB POSTING:

Gunakan salah satu hashtag di baris pertama:

#jual
#beli
#cewejomblo
#cowojomblo
#cari

Contoh:

#jual
Jual sepatu Nike original
Size 42
Harga 450rb

💰 Biaya: Rp${process.env.PRICE}
⏳ Setelah posting ada jeda 30 menit

Silakan kirim iklan sekarang.`,
{ parse_mode: "Markdown" }
  );
});

bot.on("message", async (ctx) => {
  const db = loadDB();
  const userId = ctx.from.id;

  if (!db.users[userId]) db.users[userId] = {};

  // Cooldown check
  if (isCooldown(userId, db)) {
    const remaining =
      Math.ceil(
        (process.env.COOLDOWN - (Date.now() - db.cooldown[userId])) / 60000
      );
    return ctx.reply(
      `⏳ Kamu masih dalam jeda ${remaining} menit sebelum bisa kirim lagi.`
    );
  }

  // Jika belum kirim pesan promosi
  if (!db.users[userId].message) {

    if (!ctx.message.text)
      return ctx.reply("❌ Kirim pesan dalam bentuk teks sesuai format.");

    const firstLine = ctx.message.text.split("\n")[0].toLowerCase();

    if (!allowedTags.includes(firstLine)) {
      return ctx.reply(
        "❌ Format salah!\nGunakan hashtag di baris pertama:\n#jual / #beli / #cewejomblo / #cowojomblo / #cari"
      );
    }

    db.users[userId].message = ctx.message;
    saveDB(db);

    await ctx.replyWithPhoto(process.env.QRIS_IMAGE, {
      caption:
`💳 PEMBAYARAN MENFESS IKLAN

Harga: Rp${process.env.PRICE}

Silakan scan QRIS di atas menggunakan aplikasi pembayaran apa saja.

Setelah transfer:
1. Screenshot bukti pembayaran
2. Kirim bukti di sini
3. Tunggu admin verifikasi

⚠️ 1x kirim wajib bayar
⚠️ Ada jeda 30 menit setelah posting`
    });

    return;
  }

  // Jika sudah kirim pesan, ini dianggap bukti bayar
  if (!db.users[userId].paidProof) {
    db.users[userId].paidProof = ctx.message;
    saveDB(db);

    await ctx.reply("⏳ Bukti pembayaran dikirim ke admin, tunggu konfirmasi.");

    await bot.telegram.sendMessage(
      process.env.ADMIN_GROUP_ID,
`📥 *NOTIF PEMBAYARAN MASUK*

👤 Nama: ${ctx.from.first_name}
🔗 Username: @${ctx.from.username || "Tidak ada"}
🆔 ID: ${userId}
💰 Nominal: Rp${process.env.PRICE}
🕒 Waktu: ${new Date().toLocaleString("id-ID")}

Silakan cek bukti di bawah.`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Approve Bayar", callback_data: `approvepay_${userId}` },
              { text: "❌ Tolak", callback_data: `rejectpay_${userId}` }
            ]
          ]
        }
      }
    );

    await bot.telegram.forwardMessage(
      process.env.ADMIN_GROUP_ID,
      ctx.chat.id,
      ctx.message.message_id
    );

    return;
  }
});

bot.action(/approvepay_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  const db = loadDB();

  await ctx.answerCbQuery("Pembayaran disetujui");

  await bot.telegram.sendMessage(
    process.env.ADMIN_GROUP_ID,
    `📨 Siap diposting\nUser ID: ${userId}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Approve Post", callback_data: `approvepost_${userId}` },
            { text: "❌ Reject", callback_data: `rejectpost_${userId}` }
          ]
        ]
      }
    }
  );

  await bot.telegram.forwardMessage(
    process.env.ADMIN_GROUP_ID,
    userId,
    db.users[userId].message.message_id
  );
});

bot.action(/approvepost_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  const db = loadDB();

  await ctx.answerCbQuery("Posting disetujui");

  const text = db.users[userId].message.text;

  const formattedPost =
`━━━━━━━━━━━━━━━
${text}

━━━━━━━━━━━━━━━
📢 Dipost via: @${process.env.CHANNEL_USERNAME}
✨ Powered by Menfess Iklan`;

  const sentMessage = await bot.telegram.sendMessage(
    process.env.CHANNEL_ID,
    formattedPost
  );

  const postLink = `https://t.me/${process.env.CHANNEL_USERNAME}/${sentMessage.message_id}`;

  await bot.telegram.sendMessage(
    userId,
    "✅ Iklan kamu sudah tayang!",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📢 Lihat Postingan", url: postLink }],
          [{ text: "👤 Kontak Admin", url: `https://t.me/${process.env.ADMIN_USERNAME}` }]
        ]
      }
    }
  );

  db.cooldown[userId] = Date.now();

  if (process.env.AUTO_DELETE) {
    setTimeout(async () => {
      try {
        await bot.telegram.deleteMessage(
          process.env.CHANNEL_ID,
          sentMessage.message_id
        );
      } catch (e) {}
    }, process.env.AUTO_DELETE);
  }

  delete db.users[userId];
  saveDB(db);
});

bot.action(/rejectpay_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  const db = loadDB();
  await bot.telegram.sendMessage(userId, "❌ Pembayaran ditolak.");
  delete db.users[userId];
  saveDB(db);
});

bot.action(/rejectpost_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  const db = loadDB();
  await bot.telegram.sendMessage(userId, "❌ Postingan ditolak admin.");
  delete db.users[userId];
  saveDB(db);
});

bot.launch();
console.log("Menfess Iklan Bot Running...");
