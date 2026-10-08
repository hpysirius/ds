/** 验证 ds 侧链路：抓 1688 价 → 算价 → 构造定价记录载荷（dry-run，不写库） */
import { connect, getDsToken } from './src/browser.mjs';
import { applyToDs } from './src/tasks/find1688.mjs';

const OFFER = {
  url: 'https://detail.1688.com/offer/1087462856119.html',
  title: '儿童凳子浴室脚踏凳小凳宝宝防滑加厚洗脚凳垫脚凳马桶凳简约防滑',
  offerId: '1087462856119',
};

const browser = await connect();
try {
  const tk = await getDsToken(browser);
  console.log('token 来源:', tk?.from, '| API:', tk?.apiBase);
  await applyToDs(browser, '3920720492', OFFER, tk?.apiBase || 'http://localhost:3101', { dryRun: true });
} finally {
  await browser.disconnect();
}
