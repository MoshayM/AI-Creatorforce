/* Seed two test projects for ss-live-test@cf.io — for delete/rename testing */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const USER_EMAIL = 'ss-live-test@cf.io';

async function main() {
  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!user) throw new Error(`User ${USER_EMAIL} not found — register first`);
  console.log(`User: ${user.id} (${user.email})`);

  // Upsert a test channel
  const channel = await prisma.channel.upsert({
    where: { youtubeChannelId: 'UC_DEL_TEST_12345' },
    update: { userId: user.id },
    create: {
      userId: user.id,
      youtubeChannelId: 'UC_DEL_TEST_12345',
      title: 'Test Channel (Del Test)',
      subscriberCount: 0,
      videoCount: 0,
    },
  });
  console.log(`Channel: ${channel.id} — ${channel.title}`);

  // Create two projects
  const projects = [
    { title: 'Test Project Alpha', niche: 'Technology' },
    { title: 'Test Project Beta',  niche: 'Finance' },
  ];

  for (const p of projects) {
    const existing = await prisma.project.findFirst({
      where: { userId: user.id, title: p.title },
    });
    if (existing) {
      console.log(`Project already exists: "${p.title}" (${existing.id})`);
    } else {
      const created = await prisma.project.create({
        data: { userId: user.id, channelId: channel.id, title: p.title, niche: p.niche },
      });
      console.log(`Created project: "${created.title}" (${created.id})`);
    }
  }

  console.log('\nDone. Projects are ready for del/rename testing.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
