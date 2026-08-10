import 'dotenv/config';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL no está definida');

const statements = [
  ['comments_page', `SELECT "id" FROM "Comment"
    WHERE "conversationId" = $1 AND "parentId" IS NULL AND "deletedAt" IS NULL
      AND ("createdAt" > $2 OR ("createdAt" = $2 AND "id" > $3))
    ORDER BY "createdAt" ASC, "id" ASC LIMIT 21`],
  ['notifications_page', `SELECT "id" FROM "Notification"
    WHERE "userId" = $1
      AND ("createdAt" < $2 OR ("createdAt" = $2 AND "id" < $3))
    ORDER BY "createdAt" DESC, "id" DESC LIMIT 21`],
  ['profile_completions_page', `SELECT "id", "bookId" FROM "ReadingCompletion"
    WHERE "userId" = $1
      AND ("finishedAt" < $2 OR ("finishedAt" = $2 AND "id" < $3))
    ORDER BY "finishedAt" DESC, "id" DESC LIMIT 21`],
  ['affinity_completions', `SELECT "userId", "bookId" FROM "ReadingCompletion"
    WHERE "userId" = ANY($1::text[]) AND "isReread" = false
      AND "finishedAt" >= $2 AND "finishedAt" < $3
      AND "bookId" = ANY($4::text[])`],
  ['library_user_status', `SELECT "id", "bookId" FROM "Library"
    WHERE "userId" = $1 AND "status" = $2`],
  ['clubvision_history_page', `SELECT "id" FROM "ClubvisionResult"
    WHERE "clubId" = $1
      AND ("createdAt" < $2 OR ("createdAt" = $2 AND "id" < $3))
    ORDER BY "createdAt" DESC, "id" DESC LIMIT 21`],
  ['catalog_page', `SELECT "id" FROM "Book"
    WHERE "deletedAt" IS NULL
      AND ("createdAt" < $1 OR ("createdAt" = $1 AND "id" < $2))
    ORDER BY "createdAt" DESC, "id" DESC LIMIT 21`],
  ['email_case_insensitive', `SELECT "id" FROM "User" WHERE lower("email") = lower($1) LIMIT 1`],
  ['name_case_insensitive', `SELECT "id" FROM "User" WHERE lower("name") = lower($1) LIMIT 1`],
  ['title_case_insensitive', `SELECT "id" FROM "Book" WHERE lower("title") = lower($1) LIMIT 20`],
] as const;

const values: Record<string, unknown[]> = {
  comments_page: ['diagnostic', new Date('2026-01-01'), 'diagnostic'],
  notifications_page: ['diagnostic', new Date('2026-01-01'), 'diagnostic'],
  profile_completions_page: ['diagnostic', new Date('2026-01-01'), 'diagnostic'],
  affinity_completions: [['diagnostic'], new Date('2026-01-01'), new Date('2027-01-01'), ['diagnostic']],
  library_user_status: ['diagnostic', 'PENDING'],
  clubvision_history_page: ['diagnostic', new Date('2026-01-01'), 'diagnostic'],
  catalog_page: [new Date('2026-01-01'), 'diagnostic'],
  email_case_insensitive: ['diagnostic@example.invalid'],
  name_case_insensitive: ['diagnostic'],
  title_case_insensitive: ['diagnostic'],
};

function summarize(node: any): any {
  return {
    node: node['Node Type'],
    relation: node['Relation Name'],
    index: node['Index Name'],
    planRows: node['Plan Rows'],
    totalCost: node['Total Cost'],
    sortKey: node['Sort Key'],
    children: node.Plans?.map(summarize),
  };
}

const client = new pg.Client({
  connectionString,
  statement_timeout: 5_000,
  query_timeout: 5_000,
  application_name: 'clubreads_readonly_plan_diagnostic',
});
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const extension = await client.query(
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS available`,
  );
  const plans = [];
  for (const [name, statement] of statements) {
    const result = await client.query(`EXPLAIN (FORMAT JSON) ${statement}`, values[name]);
    plans.push({ name, plan: summarize(result.rows[0]['QUERY PLAN'][0].Plan) });
  }
  await client.query('ROLLBACK');
  process.stdout.write(`${JSON.stringify({
    readOnly: true,
    analyze: false,
    pgStatStatements: Boolean(extension.rows[0]?.available),
    plans,
  })}\n`);
} finally {
  await client.end().catch(() => undefined);
}
