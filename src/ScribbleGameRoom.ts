import _ from 'lodash';
import auth from './auth';
import formatName from './formatName';
import dayjs from 'dayjs';
import lodash from 'lodash';

type Player = {
	id: number;
	username: string;
	socket: WebSocket;
	imageUrl: string;
};

export class ScribbleGameRoom {
	broadcastInterval;
	broadcastDelay = 1000;

	players: Player[];
	phase: 'ROOM_GATHERING' | 'WORD_SELECTION' | 'WORD_DRAWING' | 'WORD_NOT_SELECTED';
	phase_end_at?: string | Date;
	drawing_player?: Player;
	drawing_json?: string;
	guess_letters?: string[];

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
			phase_end_at: this.phase_end_at,
			drawing_player: this.drawing_player,
			players: this.players.map((player) => ({
				username: player.username,
				id: player.id,
				imageUrl: player.imageUrl,
			})),
			drawing_json: this.drawing_json,
			word_length: this._selectedWord?.length,
			guess_letters: this.guess_letters,
		};
	}

	static getGuessLetters(word: string) {
		const wordLetters = word.split('');
		const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
		const remainingLetters = _.difference(alphabet, wordLetters as string[]);
		const randomLetters = _.sampleSize(remainingLetters, word.length);
		return _.shuffle([...randomLetters, ...wordLetters]);
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
				this.phase_end_at = dayjs().add(40, 'seconds').toISOString();
				this._words = ['dog', 'elephant', 'car'];
				this.drawing_player = this.players[_.random(0, this.players.length - 1, false)];
			}
		}

		if (this.phase === 'WORD_SELECTION') {
			if (dayjs().isSame(this.phase_end_at) || dayjs().isAfter(this.phase_end_at)) {
				if (!this._selectedWord) {
					// case when the word was not selected in time
					this.phase = 'WORD_NOT_SELECTED';
					this.phase_end_at = dayjs().add(5, 'seconds').toISOString();
				}
			} else {
				if (this._selectedWord) {
					this.phase = 'WORD_DRAWING';
					this.phase_end_at = dayjs().add(50, 'seconds').toISOString();
					this.guess_letters = ScribbleGameRoom.getGuessLetters(this._selectedWord);
				}
			}
		}

		if (this.phase === 'WORD_NOT_SELECTED') {
			if (dayjs().isSame(this.phase_end_at) || dayjs().isAfter(this.phase_end_at)) {
				// reset to room gathering?
				this.phase = 'ROOM_GATHERING';
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
			joined_at: dayjs().toISOString(),
		};

		const inRoom = this.players.some((p) => p.id === player.id);

		if (!inRoom) {
			this.players.push(player);
		}

		// broadcast state first time right after connection
		this.broadcastState();

		webSocket.addEventListener('message', this.handleMessage);

		webSocket.addEventListener('close', this.handleClose(player.id));

		webSocket.addEventListener('error', (error) => {
			console.log('WS Error', error);
			this.handleClose(player.id)();
			player.socket.close();
		});
	}

	handleMessage = async (msg) => {
		try {
			const message = JSON.parse(msg.data as string);
			switch (message.type) {
				case 'word_select':
					if (this.phase === 'WORD_SELECTION') {
						if (this._words?.includes(message.payload.word)) {
							this._selectedWord = message.payload.word;
							console.log('ok set ', this._selectedWord);
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
	};

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
