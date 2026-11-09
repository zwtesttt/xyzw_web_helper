FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data TZ=Asia/Shanghai
WORKDIR /app/render-backend
COPY render-backend/package.json render-backend/package-lock.json ./
RUN apk add --no-cache tzdata && npm ci --omit=dev && mkdir -p /data /app/src /app/public && chown -R node:node /app /data
COPY --chown=node:node render-backend/hosted-server.js ./hosted-server.js
COPY --chown=node:node render-backend/hosted ./hosted
COPY --chown=node:node render-backend/lib ./lib
COPY --chown=node:node src/utils /app/src/utils
COPY --chown=node:node public/answer.json /app/public/answer.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "hosted-server.js"]
