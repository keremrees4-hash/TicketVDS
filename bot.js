require('dotenv').config();
const {
  Client, GatewayIntentBits, PermissionFlagsBits,
  EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, ChannelType,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const PREFIX      = '!';
const ticketCount = new Map(); // guild id → kaç ticket açıldı
const staffRoles  = new Map(); // guild id → staff rol id
const logChannels = new Map(); // guild id → log kanal id

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ─── Prefix Komutları ─────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith(PREFIX) || message.author.bot) return;

  const args    = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  function yetkiVar() {
    return message.guild.ownerId === message.author.id ||
      message.member.permissions.has(PermissionFlagsBits.Administrator);
  }

  // ─── !setup ───────────────────────────────────────────────────
  // Ticket panelini bu kanala gönderir
  if (command === 'setup') {
    if (!yetkiVar()) return message.reply('Yetkin yok.');

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎫 Destek Talep Merkezi')
      .setDescription(
        '**🎫 Destek Talep Sistemi**\n\n' +
        'Sunucumuzda yardıma ihtiyacınız olduğunda veya bir sorunla ' +
        'karşılaştığınızda destek ekibimizle iletişime geçmek için ' +
        'aşağıdaki **Ticket Oluştur** butonuna basabilirsiniz.\n\n' +
        '**📋 Ticket Kuralları:**\n' +
        '• Sorununuzu net ve anlaşılır bir şekilde açıklayın.\n' +
        '• Gereksiz yere talep açmaktan ve spam yapmaktan kaçının.\n' +
        '• Lütfen sabırlı olun, yetkili ekibimiz en kısa sürede sizinle ilgilenecektir.\n\n' +
        '─────────────────────────────────'
      )
      .setThumbnail(message.guild.iconURL({ size: 256 }))
      .setTimestamp();

    const button = new ButtonBuilder()
      .setCustomId('ticket_open')
      .setLabel('Ticket Oluştur')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
  }

  // ─── !setstaffrole @rol ───────────────────────────────────────
  else if (command === 'setstaffrole') {
    if (!yetkiVar()) return message.reply('Yetkin yok.');
    const role = message.mentions.roles.first();
    if (!role) return message.reply('Kullanım: `!setstaffrole @rol`');
    staffRoles.set(message.guild.id, role.id);
    message.channel.send(`✅ Staff rolü **${role.name}** olarak ayarlandı.`);
  }

  // ─── !setlog #kanal ───────────────────────────────────────────
  else if (command === 'setlog') {
    if (!yetkiVar()) return message.reply('Yetkin yok.');
    const ch = message.mentions.channels.first();
    if (!ch) return message.reply('Kullanım: `!setlog #kanal`');
    logChannels.set(message.guild.id, ch.id);
    message.channel.send(`✅ Log kanalı **${ch.name}** olarak ayarlandı.`);
  }
});

// ─── Buton Etkileşimleri ──────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const guild = interaction.guild;

  // ── Ticket Aç ────────────────────────────────────────────────
  if (interaction.customId === 'ticket_open') {
    await interaction.deferReply({ ephemeral: true });

    // Kişinin zaten açık ticket'ı var mı?
    const existing = guild.channels.cache.find(
      (ch) => ch.name === `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}` ||
               ch.topic === `ticket:${interaction.user.id}`
    );

    if (existing) {
      return interaction.editReply({
        content: `❌ Zaten açık bir ticket'ın var: <#${existing.id}>`,
      });
    }

    // Ticket numarasını artır
    const count = (ticketCount.get(guild.id) || 0) + 1;
    ticketCount.set(guild.id, count);
    const ticketName = `ticket-${String(count).padStart(4, '0')}`;

    // Kanal izinleri
    const overwrites = [
      {
        id: guild.roles.everyone,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ];

    // Staff rolü varsa ona da ver
    const staffRoleId = staffRoles.get(guild.id);
    if (staffRoleId) {
      overwrites.push({
        id: staffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
        ],
      });
    }

    // Kanalı oluştur
    let ticketChannel;
    try {
      ticketChannel = await guild.channels.create({
        name: ticketName,
        type: ChannelType.GuildText,
        topic: `ticket:${interaction.user.id}`,
        permissionOverwrites: overwrites,
        reason: `Ticket — ${interaction.user.tag}`,
      });
    } catch (e) {
      console.error('Ticket kanal hatası:', e.message);
      return interaction.editReply({ content: '❌ Ticket kanalı oluşturulamadı.' });
    }

    // Ticket kanalına hoşgeldin mesajı
    const ticketEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`🎫 Ticket #${String(count).padStart(4, '0')}`)
      .setDescription(
        `Merhaba <@${interaction.user.id}>, ticket'ın oluşturuldu!\n\n` +
        'Sorununuzu veya talebinizi aşağıya yazabilirsiniz.\n' +
        'Ekibimiz en kısa sürede sizinle ilgilenecektir.\n\n' +
        '─────────────────────────────────'
      )
      .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
      .setTimestamp();

    const closeButton = new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Ticket Kapat')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(closeButton);

    const staffPing = staffRoleId ? `<@&${staffRoleId}>` : '';
    await ticketChannel.send({
      content: `${staffPing} <@${interaction.user.id}>`,
      embeds: [ticketEmbed],
      components: [row],
    });

    await interaction.editReply({
      content: `✅ Ticket'ın oluşturuldu: <#${ticketChannel.id}>`,
    });
  }

  // ── Ticket Kapat ─────────────────────────────────────────────
  if (interaction.customId === 'ticket_close') {
    await interaction.deferReply();

    const channel = interaction.channel;

    // Transcript — son 100 mesajı al
    const messages = await channel.messages.fetch({ limit: 100 });
    const sorted   = [...messages.values()].reverse();
    const transcript = sorted
      .map((m) => `[${new Date(m.createdTimestamp).toLocaleString('tr-TR')}] ${m.author.tag}: ${m.content}`)
      .join('\n');

    // Log kanalına gönder
    const logChId = logChannels.get(guild.id);
    if (logChId) {
      const logCh = guild.channels.cache.get(logChId);
      if (logCh) {
        const logEmbed = new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle(`🔒 Ticket Kapatıldı — ${channel.name}`)
          .setDescription(`Kapatan: <@${interaction.user.id}>`)
          .setTimestamp();

        const buf = Buffer.from(transcript, 'utf-8');
        await logCh.send({
          embeds: [logEmbed],
          files: [{ attachment: buf, name: `${channel.name}-transcript.txt` }],
        });
      }
    }

    await interaction.editReply('🔒 Ticket kapatılıyor...');
    setTimeout(() => channel.delete('Ticket kapatıldı').catch(() => {}), 3000);
  }
});

client.login(process.env.DISCORD_TOKEN);
