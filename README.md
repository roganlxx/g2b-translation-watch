# g2b-translation-watch

나라장터 번역, 통역, 자막 관련 공고 감시기. 15분마다 GitHub Actions로 실행되며
신규 공고를 찾으면 Resend로 이메일 알림을 보낸다. 맥과 무관하게 클라우드에서 24시간 돈다.

- 키워드: 번역, 통역, 다국어, 자막, 현지화, 감수, 원어민
- 상태(seen.json)는 워크플로가 다시 커밋해 유지 → 같은 공고 중복 알림 방지
- 수의계약(수의시담, 소액수의견적) 건은 게시 후 1~5시간 만에 마감되므로 짧은 주기가 핵심

## 설정 (Secrets)
- `RESEND_API_KEY` (필수): Resend API 키. trans@wooshang.com 발신
- `ALERT_TO` (선택): 수신 이메일. 미설정 시 hxngdabin@gmail.com

## 수동 실행
Actions 탭 → g2b-translation-watch → Run workflow
