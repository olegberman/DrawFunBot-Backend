import _ from 'lodash';
import auth from './auth';
import formatName from './formatName';

type Player = {
	id: number;
	username: string;
	socket: WebSocket;
	imageUrl: string;
};

export class ScribbleGameRoom {
	broadcastInterval;
	broadcastDelay = 5000;

	players: Player[];
	phase: 'ROOM_GATHERING' | 'WORD_SELECTION' | 'WORD_DRAWING';
	drawing_player?: Player;
	drawing_json?: string;

	_words?: string[];
	_selectedWord?: string;

	constructor(state: any) {
		state.blockConcurrencyWhile(async () => {});

		this.players = [];
		this.phase = 'ROOM_GATHERING';

		this.broadcastInterval = setInterval(() => {
			this.processState();
			this.broadcastState();
		}, this.broadcastDelay);
	}

	async fetch(request: Request) {
		let pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		await this.handleWebSocketSession(server, request);
		return new Response(null, { status: 101, webSocket: pair[0] });
	}

	getRoomStateForGuessers() {
		return {
			phase: this.phase,
			drawing_player: this.drawing_player,
			players: this.players.map((player) => ({
				username: player.username,
				id: player.id,
				imageUrl: player.imageUrl,
			})),
			drawing_json: this.drawing_json,
		};
	}

	getRoomStateForDrawer() {
		return {
			...this.getRoomStateForGuessers(),
			words: this._words,
		};
	}

	processState() {
		if (this.phase === 'ROOM_GATHERING') {
			// process to next phase as soon as there are at least 2 players
			if (this.players.length >= 2) {
				this.phase = 'WORD_SELECTION';
				this._words = ['dog', 'elephant', 'car'];
				this.drawing_player = this.players[_.random(0, this.players.length, false)];
			}
		}

		if (this.phase === 'WORD_SELECTION') {
			if (this._selectedWord) {
				this.phase = 'WORD_DRAWING';
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
			imageUrl: `https://telegram-avatar.bermanoleg.workers.dev/?id=${user.id}`,
		};

		this.players.push(player);

		webSocket.addEventListener('message', this.handleMessage);

		webSocket.addEventListener('close', this.handleClose(player.id));

		webSocket.addEventListener('error', (error) => {
			console.log('WS Error', error);
			this.handleClose(player.id)();
			player.socket.close();
		});
	}

	async handleMessage(msg) {
		try {
			const message = JSON.parse(msg.data as string);
			switch (message.type) {
				case 'word_select':
					if (this.phase === 'WORD_SELECTION') {
						if (this._words?.includes(message.payload.word)) {
							this._selectedWord = message.payload.word;
						}
					}
					break;

				case 'word_draw':
					if (this.phase === 'WORD_DRAWING') {
						this.drawing_json = message.payload.drawing_json;
					}
					break;
			}
		} catch (err) {
			console.log(err);
			console.log('invalid json in websocket message');
		}
	}

	handleClose = (id: number) => () => {
		this.players = this.players.filter((player) => player.id !== id);
	};

	broadcastState() {
		for (let player of this.players) {
			if (player.id === this.drawing_player?.id) {
				player.socket.send(
					JSON.stringify({
						type: 'room:state',
						payload: this.getRoomStateForDrawer(),
					})
				);
			} else {
				player.socket.send(
					JSON.stringify({
						type: 'room:state',
						payload: this.getRoomStateForGuessers(),
					})
				);
			}
		}
	}

	async onDestroy() {
		console.log('DO is being destroyed');
		clearInterval(this.broadcastInterval);
	}
}
