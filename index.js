require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { pool } = require('./db');
const calendar = require('./calendar');
const { startServer } = require('./web');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

async function showPendingList(channel) {
    try {
        const res = await pool.query("SELECT * FROM todos WHERE status = 'pending' ORDER BY created_at ASC");
        const pendingTodos = res.rows;

        if (pendingTodos.length === 0) {
            return channel.send("📝 現在、未予定のTODOはありません！");
        }

        const embed = new EmbedBuilder()
            .setTitle('📋 未予定TODO一覧')
            .setColor(0x0099FF)
            .setDescription('実行するか、取り止めるかを選んでください。');

        const messages = [];
        messages.push({ embeds: [embed] });

        for (const t of pendingTodos) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`exec_${t.id}`).setLabel('▶ 実行').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`cancel_${t.id}`).setLabel('❌ 取止め').setStyle(ButtonStyle.Danger)
            );
            
            const timeStr = new Date(t.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            
            messages.push({
                content: `**#${t.id}** ${t.title} (登録: ${timeStr})`,
                components: [row]
            });
        }

        for (const msg of messages) {
            await channel.send(msg);
        }

    } catch (err) {
        console.error("DB Error:", err);
        channel.send("データベースエラーが発生しました。");
    }
}

async function showScheduledList(channel) {
    try {
        const res = await pool.query("SELECT * FROM todos WHERE status = 'scheduled' ORDER BY scheduled_at ASC");
        const scheduledTodos = res.rows;

        if (scheduledTodos.length === 0) {
            return channel.send("📅 現在、予定済みのTODOはありません！");
        }

        const embed = new EmbedBuilder()
            .setTitle('📅 予定済みTODO一覧')
            .setColor(0x00FF00)
            .setDescription('完了、リスケ、または取り止めを選んでください。');

        const messages = [];
        messages.push({ embeds: [embed] });

        for (const t of scheduledTodos) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`done_${t.id}`).setLabel('✅ 完了').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`resched_${t.id}`).setLabel('🔄 リスケ').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`cancelsched_${t.id}`).setLabel('❌ 取止め').setStyle(ButtonStyle.Danger)
            );
            
            const timeStr = new Date(t.scheduled_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            
            messages.push({
                content: `**#${t.id}** ${t.title} (予定: ${timeStr})`,
                components: [row]
            });
        }

        for (const msg of messages) {
            await channel.send(msg);
        }

    } catch (err) {
        console.error("DB Error:", err);
        channel.send("データベースエラーが発生しました。");
    }
}

async function showDashboard(channel) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    try {
        const pendingRes = await pool.query("SELECT * FROM todos WHERE status = 'pending' ORDER BY created_at ASC");
        const pendingTodos = pendingRes.rows;

        const scheduledRes = await pool.query(
            "SELECT * FROM todos WHERE status = 'scheduled' AND scheduled_at >= $1 AND scheduled_at <= $2 ORDER BY scheduled_at ASC",
            [todayStart.toISOString(), todayEnd.toISOString()]
        );
        const allScheduledToday = scheduledRes.rows;

        const scheduledTodos = [];
        const overdueTodos = [];
        for (const t of allScheduledToday) {
            if (new Date(t.scheduled_at) >= now) {
                scheduledTodos.push(t);
            } else {
                overdueTodos.push(t);
            }
        }

        const doneRes = await pool.query(`
            SELECT t.* FROM todos t 
            WHERE t.status = 'done' 
            AND EXISTS (
                SELECT 1 FROM actions a 
                WHERE a.todo_id = t.id 
                AND a.action_type = 'done' 
                AND a.action_at >= $1 AND a.action_at <= $2
            )
        `, [todayStart.toISOString(), todayEnd.toISOString()]);
        const doneTodos = doneRes.rows;
        
        const risukeTodos = [...overdueTodos, ...doneTodos];

        const formatTodo = (t, type) => {
            let timeStr = "";
            if (type === 'pending') {
                timeStr = new Date(t.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            } else if (type === 'scheduled' || type === 'overdue') {
                timeStr = new Date(t.scheduled_at).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' });
            } else if (type === 'done') {
                timeStr = t.scheduled_at ? new Date(t.scheduled_at).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : "未定";
            }
            return `#${t.id} ${t.title} (${timeStr})`;
        };

        const pendingText = pendingTodos.length > 0 ? pendingTodos.map(t => formatTodo(t, 'pending')).join('\n') : "なし";
        const scheduledText = scheduledTodos.length > 0 ? scheduledTodos.map(t => formatTodo(t, 'scheduled')).join('\n') : "なし";
        const risukeText = risukeTodos.length > 0 ? risukeTodos.map(t => formatTodo(t, t.status === 'done' ? 'done' : 'overdue')).join('\n') : "なし";

        const embed = new EmbedBuilder()
            .setTitle('📋 統合ダッシュボード')
            .setColor(0x0099FF)
            .addFields(
                { name: '📝 未定', value: pendingText },
                { name: '📅 予定', value: scheduledText },
                { name: '🔄 リスケする？', value: risukeText }
            );

        const options = [];
        for (const t of pendingTodos) {
            options.push(new StringSelectMenuOptionBuilder().setLabel(`[未定] ${t.title}`.substring(0, 100)).setValue(t.id.toString()));
        }
        for (const t of scheduledTodos) {
            options.push(new StringSelectMenuOptionBuilder().setLabel(`[予定] ${t.title}`.substring(0, 100)).setValue(t.id.toString()));
        }
        for (const t of risukeTodos) {
            options.push(new StringSelectMenuOptionBuilder().setLabel(`[リスケ] ${t.title}`.substring(0, 100)).setValue(t.id.toString()));
        }

        const finalOptions = options.slice(0, 25);
        const closeBtnRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dashboard_close').setLabel('🏁 確認（閉じる）').setStyle(ButtonStyle.Secondary)
        );

        if (finalOptions.length > 0) {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('dashboard_select_todo')
                .setPlaceholder('操作するTODOを選択してください')
                .addOptions(finalOptions);
            const row = new ActionRowBuilder().addComponents(selectMenu);
            await channel.send({ embeds: [embed], components: [row, closeBtnRow] });
        } else {
            await channel.send({ embeds: [embed], components: [closeBtnRow] });
        }

    } catch (err) {
        console.error("Dashboard DB Error:", err);
        channel.send("データベースエラーが発生しました。");
    }
}

client.once('ready', () => {
    console.log(`ログイン完了: ${client.user.tag} がオンラインになりました！`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const text = message.content.trim();
    const lowerText = text.toLowerCase();
    
    if (lowerText.startsWith('!') || lowerText.startsWith('！')) {
        const match = text.match(/^[!！][\s　]*(.+)$/);
        if (match && match[1]) {
            const title = match[1].trim();
            if (title.toLowerCase() === 'list') {
                await showPendingList(message.channel);
                return;
            }
            if (title.toLowerCase() === 'scheduled') {
                await showScheduledList(message.channel);
                return;
            }
            if (title === '予定' || title === '確認' || title === '一覧' || title === 'まとめ' || title === '予定出して') {
                await showDashboard(message.channel);
                return;
            }
            if (title.toLowerCase() === 'analyze' || title === '分析') {
                const url = process.env.PUBLIC_URL || 'http://localhost:3000';
                await message.reply(`📊 じぞーの分析ページはこちらです：\n${url}`);
                return;
            }
            try {
                const res = await pool.query(
                    "INSERT INTO todos (title, status) VALUES ($1, 'pending') RETURNING *",
                    [title]
                );
                const newTodo = res.rows[0];
                
                await pool.query(
                    "INSERT INTO actions (todo_id, action_type) VALUES ($1, 'created')",
                    [newTodo.id]
                );

                try {
                    await message.react('✅');
                } catch (e) {
                    // リアクション失敗時は無応答でよい
                }
            } catch (err) {
                console.error(err);
            }
        }
        return;
    }
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'dashboard_select_todo') {
                const todoId = interaction.values[0];
                const res = await pool.query("SELECT * FROM todos WHERE id = $1", [todoId]);
                if (res.rows.length === 0) {
                    return interaction.reply({ content: '❌ TODOが見つかりません。', ephemeral: true });
                }
                const todo = res.rows[0];
                const now = new Date();

                let category = 'pending';
                if (todo.status === 'scheduled') {
                    if (new Date(todo.scheduled_at) < now) {
                        category = 'overdue';
                    } else {
                        category = 'scheduled';
                    }
                } else if (todo.status === 'done') {
                    category = 'done';
                }

                const options = [];
                if (category === 'pending') {
                    options.push(
                        new StringSelectMenuOptionBuilder().setLabel('🗓️ 計画する').setValue(`action_plan_${todoId}`),
                        new StringSelectMenuOptionBuilder().setLabel('⏸️ 保留（後回し）').setValue(`action_hold_${todoId}`),
                        new StringSelectMenuOptionBuilder().setLabel('❌ 取止め').setValue(`action_cancel_${todoId}`)
                    );
                } else if (category === 'scheduled') {
                    options.push(
                        new StringSelectMenuOptionBuilder().setLabel('✅ 完了にする').setValue(`action_done_${todoId}`),
                        new StringSelectMenuOptionBuilder().setLabel('🔄 変更する').setValue(`action_change_${todoId}`),
                        new StringSelectMenuOptionBuilder().setLabel('❌ 取止め').setValue(`action_cancel_${todoId}`)
                    );
                } else if (category === 'overdue' || category === 'done') {
                    options.push(
                        new StringSelectMenuOptionBuilder().setLabel('✅ 完全に完了').setValue(`action_fulldone_${todoId}`),
                        new StringSelectMenuOptionBuilder().setLabel('🔄 再リスケ').setValue(`action_resched_${todoId}`)
                    );
                }

                const actionMenu = new StringSelectMenuBuilder()
                    .setCustomId('dashboard_action_select')
                    .setPlaceholder('実行するアクションを選択してください')
                    .addOptions(options);

                const row = new ActionRowBuilder().addComponents(actionMenu);
                await interaction.reply({ 
                    content: `**#${todo.id} ${todo.title}** に対するアクションを選択してください：`, 
                    components: [row], 
                    ephemeral: true 
                });
                return;
            }

            if (interaction.customId === 'dashboard_action_select') {
                const actionValue = interaction.values[0];
                const parts = actionValue.split('_');
                const action = parts[1];
                const todoId = parts[2];

                if (action === 'plan') {
                    const now = new Date();
                    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
                    const jstNow = new Date(utc + (9 * 3600000));
                    const initialValue = `${jstNow.getFullYear()}${(jstNow.getMonth() + 1).toString().padStart(2, '0')}${jstNow.getDate().toString().padStart(2, '0')}${jstNow.getHours().toString().padStart(2, '0')}${jstNow.getMinutes().toString().padStart(2, '0')}`;
                    const modal = new ModalBuilder()
                        .setCustomId(`modal_exec_${todoId}`)
                        .setTitle('日時を設定して予定化');
                    const datetimeInput = new TextInputBuilder()
                        .setCustomId('datetimeInput')
                        .setLabel('4桁(HHmm) / 8桁(MMDD..) / 12桁で入力')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(4)
                        .setMaxLength(12)
                        .setValue(initialValue);
                    modal.addComponents(new ActionRowBuilder().addComponents(datetimeInput));
                    await interaction.showModal(modal);
                    return;
                }

                if (action === 'change' || action === 'resched') {
                    const now = new Date();
                    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
                    const jstNow = new Date(utc + (9 * 3600000));
                    const initialValue = `${jstNow.getFullYear()}${(jstNow.getMonth() + 1).toString().padStart(2, '0')}${jstNow.getDate().toString().padStart(2, '0')}${jstNow.getHours().toString().padStart(2, '0')}${jstNow.getMinutes().toString().padStart(2, '0')}`;
                    const modal = new ModalBuilder()
                        .setCustomId(`modal_resched_${todoId}`)
                        .setTitle('新しい日時を設定してリスケ');
                    const datetimeInput = new TextInputBuilder()
                        .setCustomId('datetimeInput')
                        .setLabel('4桁(HHmm) / 8桁(MMDD..) / 12桁で入力')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(4)
                        .setMaxLength(12)
                        .setValue(initialValue);
                    modal.addComponents(new ActionRowBuilder().addComponents(datetimeInput));
                    await interaction.showModal(modal);
                    return;
                }

                if (action === 'hold') {
                    await pool.query("INSERT INTO actions (todo_id, action_type) VALUES ($1, 'held')", [todoId]);
                    await interaction.update({ content: `⏸️ TODO #${todoId} を保留（後回し）にしました。`, components: [] });
                    return;
                }

                if (action === 'cancel') {
                    const res = await pool.query("SELECT calendar_event_id FROM todos WHERE id = $1", [todoId]);
                    if (res.rows.length > 0 && res.rows[0].calendar_event_id) {
                        await calendar.deleteEvent(res.rows[0].calendar_event_id);
                    }
                    await pool.query("UPDATE todos SET status = 'cancelled' WHERE id = $1", [todoId]);
                    await pool.query("INSERT INTO actions (todo_id, action_type) VALUES ($1, 'cancelled')", [todoId]);
                    await interaction.update({ content: `❌ TODO #${todoId} を取り止めました。`, components: [] });
                    return;
                }

                if (action === 'done' || action === 'fulldone') {
                    await pool.query("UPDATE todos SET status = 'done' WHERE id = $1", [todoId]);
                    await pool.query("INSERT INTO actions (todo_id, action_type) VALUES ($1, 'done')", [todoId]);
                    await interaction.update({ content: `✅ TODO #${todoId} を完了にしました！お疲れ様です！`, components: [] });
                    return;
                }
            }
        }

        if (interaction.isButton()) {
            const customId = interaction.customId;

            if (customId === 'dashboard_close') {
                await interaction.deferUpdate().catch(console.error);
                await interaction.message.delete().catch(console.error);
                return;
            }

            if (customId.startsWith('exec_')) {
                const todoId = customId.split('_')[1];
                const now = new Date();
                const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
                const jstNow = new Date(utc + (9 * 3600000));
                const initialValue = `${jstNow.getFullYear()}${(jstNow.getMonth() + 1).toString().padStart(2, '0')}${jstNow.getDate().toString().padStart(2, '0')}${jstNow.getHours().toString().padStart(2, '0')}${jstNow.getMinutes().toString().padStart(2, '0')}`;
                const modal = new ModalBuilder()
                    .setCustomId(`modal_exec_${todoId}`)
                    .setTitle('日時を設定して予定化');

                const datetimeInput = new TextInputBuilder()
                    .setCustomId('datetimeInput')
                    .setLabel('4桁(HHmm) / 8桁(MMDD..) / 12桁で入力')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMinLength(4)
                    .setMaxLength(12)
                    .setValue(initialValue);

                const firstActionRow = new ActionRowBuilder().addComponents(datetimeInput);
                modal.addComponents(firstActionRow);
                await interaction.showModal(modal);
                return;
            }

            if (customId.startsWith('confirmexec_')) {
                const parts = customId.split('_');
                const todoId = parts[1];
                const inputStr = parts[2];

                await interaction.reply({ content: '⏳ Googleカレンダーに登録しています...', ephemeral: true });

                const year = inputStr.substring(0, 4);
                const month = inputStr.substring(4, 6);
                const day = inputStr.substring(6, 8);
                const hour = inputStr.substring(8, 10);
                const min = inputStr.substring(10, 12);
                const dateObj = new Date(year, parseInt(month) - 1, day, hour, min);

                const res = await pool.query("SELECT title FROM todos WHERE id = $1", [todoId]);
                if (res.rows.length === 0) {
                    return interaction.editReply('❌ TODOが見つかりません。');
                }
                const title = res.rows[0].title;

                const eventId = await calendar.addEvent(title, dateObj.toISOString());
                if (!eventId) {
                    return interaction.editReply('❌ Googleカレンダーの登録に失敗しました。');
                }

                await pool.query(
                    "UPDATE todos SET status = 'scheduled', scheduled_at = $1, calendar_event_id = $2 WHERE id = $3",
                    [dateObj.toISOString(), eventId, todoId]
                );
                await pool.query(
                    "INSERT INTO actions (todo_id, action_type, action_at) VALUES ($1, 'scheduled', CURRENT_TIMESTAMP)",
                    [todoId]
                );

                await interaction.editReply(`✅ Googleカレンダーに予定を登録し、予定済み一覧へ移動しました！`);
                return;
            }

            if (customId.startsWith('cancelexec_')) {
                await interaction.reply({ content: '予定化をキャンセルしました。', ephemeral: true });
                return;
            }

            if (customId.startsWith('cancel_')) {
                const todoId = customId.split('_')[1];
                await pool.query("UPDATE todos SET status = 'cancelled' WHERE id = $1", [todoId]);
                await pool.query(
                    "INSERT INTO actions (todo_id, action_type, action_at) VALUES ($1, 'cancelled', CURRENT_TIMESTAMP)",
                    [todoId]
                );
                await interaction.reply({ content: `🗑️ TODO #${todoId} を取り止めました。`, ephemeral: true });
                return;
            }

            // --- ここから Step 5 & 6 の処理 ---
            if (customId.startsWith('done_')) {
                const todoId = customId.split('_')[1];
                await pool.query("UPDATE todos SET status = 'done' WHERE id = $1", [todoId]);
                await pool.query("INSERT INTO actions (todo_id, action_type) VALUES ($1, 'done')", [todoId]);
                await interaction.reply({ content: `✅ TODO #${todoId} を「完了」にしました！お疲れ様です！`, ephemeral: true });
                return;
            }

            if (customId.startsWith('cancelsched_')) {
                const todoId = customId.split('_')[1];
                const res = await pool.query("SELECT calendar_event_id FROM todos WHERE id = $1", [todoId]);
                if (res.rows.length > 0 && res.rows[0].calendar_event_id) {
                    await calendar.deleteEvent(res.rows[0].calendar_event_id);
                }
                await pool.query("UPDATE todos SET status = 'cancelled' WHERE id = $1", [todoId]);
                await pool.query("INSERT INTO actions (todo_id, action_type) VALUES ($1, 'cancelled')", [todoId]);
                await interaction.reply({ content: `🗑️ TODO #${todoId} を取り止め、カレンダーからも削除しました。`, ephemeral: true });
                return;
            }

            if (customId.startsWith('resched_')) {
                const todoId = customId.split('_')[1];
                const now = new Date();
                const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
                const jstNow = new Date(utc + (9 * 3600000));
                const initialValue = `${jstNow.getFullYear()}${(jstNow.getMonth() + 1).toString().padStart(2, '0')}${jstNow.getDate().toString().padStart(2, '0')}${jstNow.getHours().toString().padStart(2, '0')}${jstNow.getMinutes().toString().padStart(2, '0')}`;
                const modal = new ModalBuilder()
                    .setCustomId(`modal_resched_${todoId}`)
                    .setTitle('新しい日時を設定してリスケ');

                const datetimeInput = new TextInputBuilder()
                    .setCustomId('datetimeInput')
                    .setLabel('4桁(HHmm) / 8桁(MMDD..) / 12桁で入力')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMinLength(4)
                    .setMaxLength(12)
                    .setValue(initialValue);

                const firstActionRow = new ActionRowBuilder().addComponents(datetimeInput);
                modal.addComponents(firstActionRow);
                await interaction.showModal(modal);
                return;
            }

            if (customId.startsWith('confirmresched_')) {
                const parts = customId.split('_');
                const todoId = parts[1];
                const inputStr = parts[2];

                await interaction.reply({ content: '⏳ Googleカレンダーを更新しています...', ephemeral: true });

                const year = inputStr.substring(0, 4);
                const month = inputStr.substring(4, 6);
                const day = inputStr.substring(6, 8);
                const hour = inputStr.substring(8, 10);
                const min = inputStr.substring(10, 12);
                const newDateObj = new Date(year, parseInt(month) - 1, day, hour, min);

                const res = await pool.query("SELECT title, calendar_event_id, scheduled_at FROM todos WHERE id = $1", [todoId]);
                if (res.rows.length === 0) {
                    return interaction.editReply('❌ TODOが見つかりません。');
                }
                const { title, calendar_event_id, scheduled_at } = res.rows[0];

                if (!calendar_event_id) {
                    return interaction.editReply('❌ 連携されたカレンダー情報が見つかりません。');
                }

                const success = await calendar.updateEvent(calendar_event_id, title, newDateObj.toISOString());
                if (!success) {
                    return interaction.editReply('❌ Googleカレンダーの更新に失敗しました。');
                }

                await pool.query(
                    "UPDATE todos SET scheduled_at = $1 WHERE id = $2",
                    [newDateObj.toISOString(), todoId]
                );
                await pool.query(
                    "INSERT INTO actions (todo_id, action_type, action_at, from_time, to_time) VALUES ($1, 'rescheduled', CURRENT_TIMESTAMP, $2, $3)",
                    [todoId, scheduled_at, newDateObj.toISOString()]
                );

                await interaction.editReply(`✅ Googleカレンダーの予定を新しい日時にリスケしました！`);
                return;
            }

            if (customId.startsWith('cancelresched_')) {
                await interaction.reply({ content: 'リスケをキャンセルしました。', ephemeral: true });
                return;
            }
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('modal_exec_') || interaction.customId.startsWith('modal_resched_')) {
                const isResched = interaction.customId.startsWith('modal_resched_');
                const todoId = interaction.customId.split('_')[2];
                const inputStr = interaction.fields.getTextInputValue('datetimeInput');
                
                if (!/^(\d{4}|\d{8}|\d{12})$/.test(inputStr)) {
                    return interaction.reply({ content: '❌ フォーマットが間違っています。4桁、8桁、または12桁の半角数字で入力してください。', ephemeral: true });
                }
                
                const now = new Date();
                let year = now.getFullYear();
                let month = now.getMonth() + 1;
                let day = now.getDate();
                let hour = 0;
                let min = 0;

                if (inputStr.length === 4) {
                    hour = parseInt(inputStr.substring(0, 2), 10);
                    min = parseInt(inputStr.substring(2, 4), 10);
                } else if (inputStr.length === 8) {
                    month = parseInt(inputStr.substring(0, 2), 10);
                    day = parseInt(inputStr.substring(2, 4), 10);
                    hour = parseInt(inputStr.substring(4, 6), 10);
                    min = parseInt(inputStr.substring(6, 8), 10);
                } else if (inputStr.length === 12) {
                    year = parseInt(inputStr.substring(0, 4), 10);
                    month = parseInt(inputStr.substring(4, 6), 10);
                    day = parseInt(inputStr.substring(6, 8), 10);
                    hour = parseInt(inputStr.substring(8, 10), 10);
                    min = parseInt(inputStr.substring(10, 12), 10);
                }
                
                const isoStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:00+09:00`;
                const dateObj = new Date(isoStr);
                if (isNaN(dateObj.getTime())) {
                    return interaction.reply({ content: '❌ 無効な日時です。', ephemeral: true });
                }

                await interaction.reply({ content: '⏳ Googleカレンダーに登録しています...', ephemeral: true });

                const res = await pool.query("SELECT title, calendar_event_id, scheduled_at FROM todos WHERE id = $1", [todoId]);
                if (res.rows.length === 0) {
                    return interaction.editReply('❌ TODOが見つかりません。');
                }
                const { title, calendar_event_id, scheduled_at } = res.rows[0];

                if (isResched) {
                    if (!calendar_event_id) {
                        return interaction.editReply('❌ 連携されたカレンダー情報が見つかりません。');
                    }
                    const success = await calendar.updateEvent(calendar_event_id, title, dateObj.toISOString());
                    if (!success) {
                        return interaction.editReply('❌ Googleカレンダーの更新に失敗しました。');
                    }
                    await pool.query(
                        "UPDATE todos SET scheduled_at = $1 WHERE id = $2",
                        [dateObj.toISOString(), todoId]
                    );
                    await pool.query(
                        "INSERT INTO actions (todo_id, action_type, action_at, from_time, to_time) VALUES ($1, 'rescheduled', CURRENT_TIMESTAMP, $2, $3)",
                        [todoId, scheduled_at, dateObj.toISOString()]
                    );
                } else {
                    const eventId = await calendar.addEvent(title, dateObj.toISOString());
                    if (!eventId) {
                        return interaction.editReply('❌ Googleカレンダーの登録に失敗しました。');
                    }
                    await pool.query(
                        "UPDATE todos SET status = 'scheduled', scheduled_at = $1, calendar_event_id = $2 WHERE id = $3",
                        [dateObj.toISOString(), eventId, todoId]
                    );
                    await pool.query(
                        "INSERT INTO actions (todo_id, action_type, action_at) VALUES ($1, 'scheduled', CURRENT_TIMESTAMP)",
                        [todoId]
                    );
                }

                const days = ['日', '月', '火', '水', '木', '金', '土'];
                const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
                const dayStr = days[dayOfWeek];
                const timeMsg = `**${year}年${month}月${day}日（${dayStr}）${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}**`;

                if (isResched) {
                    await interaction.editReply(`✅ Googleカレンダーの予定を ${timeMsg} にリスケしました！`);
                } else {
                    await interaction.editReply(`✅ ${timeMsg} でGoogleカレンダーに予定を登録し、予定済み一覧へ移動しました！`);
                }
                return;
            }
        }
    } catch (err) {
        console.error("Interaction Error:", err);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "エラーが発生しました。", ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
startServer(process.env.PORT || 3000);
