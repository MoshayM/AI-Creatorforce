/* One-off seed for scheduler page testing — safe to re-run (upserts by unique keys). */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const USER_EMAIL = 'scheduler-test@example.com';
const THUMB = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';

const day = (offset, hour = 15) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, 0, 0, 0);
  return d;
};

async function main() {
  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!user) throw new Error(`user ${USER_EMAIL} not found — register first`);

  const channel = await prisma.channel.upsert({
    where: { youtubeChannelId: 'UC_SCHED_TEST' },
    update: { userId: user.id },
    create: {
      userId: user.id,
      youtubeChannelId: 'UC_SCHED_TEST',
      title: 'Sched Test Channel',
      subscriberCount: 1200,
      videoCount: 6,
    },
  });

  let project = await prisma.project.findFirst({ where: { userId: user.id, title: 'Scheduler Test Project' } });
  if (!project) {
    project = await prisma.project.create({
      data: { userId: user.id, channelId: channel.id, title: 'Scheduler Test Project', niche: 'tech' },
    });
  }

  const videos = [
    { title: 'Upcoming: AI News Weekly #12', status: 'SCHEDULED', scheduledAt: day(1, 18) },
    { title: 'Upcoming: Top 5 Editing Tricks', status: 'SCHEDULED', scheduledAt: day(3, 12) },
    { title: 'Upcoming: Creator Q&A Livestream Recap', status: 'SCHEDULED', scheduledAt: day(9, 17) },
    { title: 'Published: How I Automate YouTube', status: 'PUBLISHED', publishedAt: day(-2, 18), youtubeVideoId: 'dQw4w9WgXcQ', viewCount: 15230, likeCount: 890, commentCount: 132, thumbnailUrl: THUMB },
    { title: 'Published: Shorts Strategy 2026', status: 'PUBLISHED', publishedAt: day(-6, 12), youtubeVideoId: 'test_pub_02', viewCount: 4021, likeCount: 233, commentCount: 41, thumbnailUrl: THUMB },
    { title: 'Published: My Studio Setup Tour', status: 'PUBLISHED', publishedAt: day(-15, 15), youtubeVideoId: 'test_pub_03', viewCount: 980, likeCount: 77, commentCount: 12 },
    { title: 'Failed upload: Podcast Episode 3', status: 'FAILED', scheduledAt: day(-1, 9) },
  ];

  for (const v of videos) {
    const existing = await prisma.video.findFirst({ where: { projectId: project.id, title: v.title } });
    if (existing) {
      await prisma.video.update({ where: { id: existing.id }, data: v });
    } else {
      await prisma.video.create({ data: { ...v, projectId: project.id, channelId: channel.id } });
    }
  }

  console.log(`seeded: channel=${channel.id} project=${project.id} videos=${videos.length}`);
}

main().finally(() => prisma.$disconnect());
