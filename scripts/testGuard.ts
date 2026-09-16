// node --test 시작 전에 한 번 돌아, 테스트가 운영 DB에 붙는 것을 막는다(판정은 src/lib/testDbGuard.ts).
// package.json의 test 스크립트가 --import 로 불러온다.
import { testDbTarget } from '../src/lib/testDbGuard.ts';

const r = testDbTarget(process.env);
if (r.kind === 'blocked') {
  console.error(`\n테스트를 시작하지 않았어요.\n  ${r.message}\n`);
  process.exit(2);
}
