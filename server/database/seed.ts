import { eq } from 'drizzle-orm'
import { PlanSchema } from '../../shared/schemas/plan'
import { auth } from '../utils/auth'
import { db } from '../utils/db'
import { agentsMd, planVersions, plans, user } from './schema'

/** 种子数据：初始 admin 账号 + 示例规划 + 默认全局 AGENTS.md（需先 db:migrate） */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin123456'

const DEFAULT_AGENTS_MD = `# 全局偏好（AGENTS.md 示例）

- 称呼我：{{nickname}}
- 默认货币：{{currency}}
- 出行节奏：每天 2-3 个景点，留出休息与用餐时间，不要赶路
- 饮食：不吃辣，偏好本地小吃
- 预算：中等偏经济，明细尽量写清楚
- 语言风格：简洁克制，先给结构化行程，再补充必要说明
`

async function seed() {
  let [admin] = await db.select().from(user).where(eq(user.email, ADMIN_EMAIL))
  if (!admin) {
    await auth.api.signUpEmail({
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: '管理员' },
    })
    await db.update(user).set({ role: 'admin' }).where(eq(user.email, ADMIN_EMAIL))
    ;[admin] = await db.select().from(user).where(eq(user.email, ADMIN_EMAIL))
    console.log(`[db:seed] admin 已创建：${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
  } else {
    console.log(`[db:seed] admin 已存在：${ADMIN_EMAIL}`)
  }
  if (!admin) throw new Error('[db:seed] admin 创建失败')

  const existingPlans = await db.select().from(plans).where(eq(plans.userId, admin.id))
  if (existingPlans.length === 0) {
    const planJson = PlanSchema.parse({
      title: '江南四日 · 示例行程',
      summary: '杭州西湖 → 灵隐寺 → 苏州园林，慢节奏人文之旅',
      cover: '',
      days: [
        {
          date: '2026-10-01',
          city: '杭州',
          spots: [
            { name: '断桥残雪', lng: 120.1505, lat: 30.2604, time: '09:00', notes: '清晨人少，适合拍照' },
            { name: '平湖秋月', lng: 120.1439, lat: 30.2566, time: '11:00', notes: '临湖茶座小憩' },
          ],
          transport: '地铁 1 号线 → 公交 7 路',
          lodging: '西湖边民宿',
          meals: ['知味观（午餐）', '楼外楼（晚餐）'],
        },
        {
          date: '2026-10-02',
          city: '杭州',
          spots: [
            { name: '灵隐寺', lng: 120.101, lat: 30.2406, time: '09:30', notes: '需购飞来峰门票' },
            { name: '龙井村', lng: 120.1047, lat: 30.2164, time: '14:00', notes: '茶园散步，可品茶' },
          ],
          transport: '公交 7 路 / 打车约 25 分钟',
          lodging: '西湖边民宿',
          meals: ['灵隐素面（午餐）', '青芝坞小馆（晚餐）'],
        },
      ],
      tips: ['十月杭州早晚微凉，备一件薄外套', '景区周末人多，建议早出门'],
      budget: { total: 3200, currency: 'CNY', breakdown: { 交通: 800, 住宿: 1200, 餐饮: 700, 门票: 500 } },
      tags: ['江南', '人文', '慢旅行'],
    })
    const [plan] = await db
      .insert(plans)
      .values({
        userId: admin.id,
        title: planJson.title,
        summary: planJson.summary,
        contentMd: `# ${planJson.title}\n\n${planJson.summary}\n`,
        planJson,
        coverUrl: planJson.cover,
      })
      .returning()
    await db.insert(planVersions).values({
      planId: plan!.id,
      version: 1,
      planJson,
      createdBy: admin.id,
      source: 'user',
      diffJson: null,
    })
    console.log(`[db:seed] 示例规划 #${plan!.id} 已创建`)
  }

  const existingMd = await db.select().from(agentsMd).where(eq(agentsMd.userId, admin.id))
  if (existingMd.length === 0) {
    await db.insert(agentsMd).values({ userId: admin.id, planId: null, content: DEFAULT_AGENTS_MD })
    console.log('[db:seed] 默认全局 AGENTS.md 已创建')
  }

  console.log('[db:seed] 完成')
}

await seed()
process.exit(0)
