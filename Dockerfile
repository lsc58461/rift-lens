# 런타임 패키징 전용 — 빌드는 GitHub Actions ARM 러너에서 수행하고,
# 여기서는 .next/standalone 산출물만 담는다 (CI에서 NEXT_STANDALONE=1 next build 선행 필수).
FROM node:22-alpine

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

WORKDIR /app

# standalone: server.js + 최소 node_modules / static·public은 별도 복사 필요
# --chown 필수: USER node가 ISR 캐시(.next/server/app/*.html)를 다시 써야 한다
COPY --chown=node:node .next/standalone ./
COPY --chown=node:node .next/static ./.next/static
COPY --chown=node:node public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]
