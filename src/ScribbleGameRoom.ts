import _ from 'lodash';
import auth from './auth';
import formatName from './formatName';

type Player = {
	id: number;
	username: string;
	socket: WebSocket;
};

export class ScribbleGameRoom {
	broadcastInterval;
	broadcastDelay = 5000;

	players: Player[];
	phase: 'ROOM_GATHERING' | 'WORD_SELECTION';
	drawingPlayer?: Player;
	words: string[];

	constructor(state: any) {
		state.blockConcurrencyWhile(async () => {});

		this.players = [];
		this.words = [];
		this.phase = 'ROOM_GATHERING';
		this.broadcastInterval = setInterval(() => this.broadcastState(), this.broadcastDelay);
	}

	async fetch(request: Request) {
		let pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		await this.handleWebSocketSession(server, request);
		return new Response(null, { status: 101, webSocket: pair[0] });
	}

	getRoomState() {
		return {
			phase: this.phase,
			drawingPlayer: this.drawingPlayer,
			players: this.players.map((player) => ({
				username: player.username,
				id: player.id,
			})),
		};
	}

	processState() {
		if ((this.phase = 'ROOM_GATHERING')) {
			// process to next phase as soon as there are at least 2 players
			if (this.players.length >= 2) {
				this.phase = 'WORD_SELECTION';
				this.words = ['dog', 'elephant', 'car'];
				this.drawingPlayer = this.players[_.random(0, this.players.length, false)];
			}
		}
	}

	async handleWebSocketSession(webSocket: WebSocket, request: Request) {
		const url = new URL(request.url);
		const authData = url.searchParams.get('auth');

		const user = auth(authData as string, request.headers.get('bot_token') as string);

		webSocket.accept();

		const player = {
			socket: webSocket,
			username: formatName(user),
			id: user.id,
		};

		this.players.push(player);

		webSocket.addEventListener('message', async (msg) => {
			try {
				const message = JSON.parse(msg.data as string);
				switch (message.type) {
					case 'room:join':
				}
			} catch (err) {
				console.log(err);
				console.log('invalid json in websocket message');
			}
		});

		webSocket.addEventListener('close', this.handleClose(player.id));

		webSocket.addEventListener('error', (error) => {
			console.log('WS Error', error);
			this.handleClose(player.id)();
			player.socket.close();
		});
	}

	handleClose = (id: number) => () => {
		this.players = this.players.filter((player) => player.id !== id);
	};

	broadcastState() {
		this.broadcast({
			type: 'room:state',
			payload: this.getRoomState(),
		});
	}

	broadcast(message: any, toPlayers?: Player[]) {
		if (typeof message !== 'string') {
			message = JSON.stringify(message);
		}
		if (!toPlayers) {
			toPlayers = this.players;
		}
		for (let player of toPlayers) {
			console.log('sent', message);
			player.socket.send(message);
		}
	}

	async onDestroy() {
		console.log('DO is being destroyed');
		clearInterval(this.broadcastInterval);
	}
}
