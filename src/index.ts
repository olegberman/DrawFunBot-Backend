/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { ScribbleGameRoom } from './ScribbleGameRoom';
import { rooms } from '@olegberman/drawfunbot-db';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === '/game') {
			// Expect to receive a WebSocket Upgrade request.
			// If there is one, accept the request and return a WebSocket Response.
			const upgradeHeader = request.headers.get('Upgrade');
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				return new Response('Durable Object expected Upgrade: websocket', { status: 426 });
			}

			const roomId = url.searchParams.get('id') || 'default';

			const db = drizzle(env.DB);
			let roomsFound = [];
			try {
				roomsFound = await db.select().from(rooms).where(eq(rooms.id, roomId));
			} catch (err) {
				console.log(err);
			}
			if (roomsFound.length > 0) {
				let id = env.SCRIBBLE_GAME_ROOM.idFromName(roomId);
				let stub = env.SCRIBBLE_GAME_ROOM.get(id);

				return await stub.fetch(request, {
					headers: {
						Upgrade: 'websocket',
						bot_token: env.BOT_TOKEN,
						room_id: roomId,
					},
				});
			} else {
				return new Response(null, {
					status: 404,
					statusText: 'Bad Request',
					headers: {
						'Content-Type': 'text/plain',
					},
				});
			}
		}

		return new Response(null, {
			status: 400,
			statusText: 'Bad Request',
			headers: {
				'Content-Type': 'text/plain',
			},
		});
	},
} satisfies ExportedHandler<Env>;

export { ScribbleGameRoom };
