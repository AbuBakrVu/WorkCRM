# ---------- сборка фронтенда ----------
FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build   # результат кладётся в /app/server/public

# ---------- рантайм ----------
FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
# LibreOffice — для PDF из шаблонов Word; шрифты, совместимые с Times/Arial, + Montserrat (шаблон КП)
RUN apk add --no-cache libreoffice-writer font-liberation font-dejavu fontconfig ttf-freefont \
 && (command -v soffice || ln -s "$(command -v libreoffice)" /usr/local/bin/soffice) \
 && mkdir -p /usr/share/fonts/montserrat \
 && for w in Regular Medium SemiBold Bold Italic; do \
      wget -q -O /usr/share/fonts/montserrat/Montserrat-$w.ttf https://raw.githubusercontent.com/JulietaUla/Montserrat/master/fonts/ttf/Montserrat-$w.ttf || true; \
    done \
 && find /usr/share/fonts/montserrat -size 0 -delete; fc-cache -f
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/src ./src
COPY --from=client /app/server/public ./public
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
