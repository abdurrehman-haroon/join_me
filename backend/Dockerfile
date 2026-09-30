FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
RUN CGO_ENABLED=0 go build -o /api ./cmd/api

FROM alpine:3.21
RUN adduser -D app
USER app
COPY --from=build /api /api
EXPOSE 8080
CMD ["/api"]

