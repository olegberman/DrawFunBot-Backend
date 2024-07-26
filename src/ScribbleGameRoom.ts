import _ from 'lodash';
import auth from './auth';
import formatName from './formatName';
import dayjs from 'dayjs';
import words from './words';

type Player = {
	id: number;
	username: string;
	sockets: WebSocket[];
	imageUrl: string;
	score: number;
	guessed?: boolean;
	guessed_seconds?: null | number;
};

type Phase = 'ROOM_GATHERING' | 'WORD_SELECTION' | 'WORD_DRAWING' | 'WORD_NOT_SELECTED' | 'ROUND_RESULTS';

const durations: Record<Phase, number> = {
	ROOM_GATHERING: 5,
	WORD_DRAWING: 60,
	WORD_NOT_SELECTED: 10,
	WORD_SELECTION: 20,
	ROUND_RESULTS: 12,
};

export class ScribbleGameRoom {
	broadcastInterval;
	broadcastDelay = 1000;

	players: Player[];
	phase: Phase;
	round: number;
	phase_end_at?: string | Date;
	phase_start_at?: string | Date;
	drawing_player?: Player;
	drawing_json?: string;
	guess_letters?: string[];

	_words?: string[];
	_selectedWord?: string;

	_lastMovePlayerIndex: number;

	constructor(state: any) {
		state.blockConcurrencyWhile(async () => {});

		this.players = [];
		this.phase = 'ROOM_GATHERING';
		this.round = 1;
		this._lastMovePlayerIndex = -1;

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
		const withWord =
			this.phase === 'ROUND_RESULTS'
				? {
						selectedWord: this._selectedWord,
				  }
				: {};
		return {
			round: this.round,
			phase: this.phase,
			phase_end_at: this.phase_end_at,
			drawing_player: this.drawing_player,
			players: this.players.map((player) => ({
				username: player.username,
				id: player.id,
				imageUrl: player.imageUrl,
				guessed: player.guessed,
				guessed_seconds: player.guessed_seconds,
				score: player.score,
				connected: player.sockets.length > 0,
			})),
			drawing_json: this.drawing_json,
			word_length: this._selectedWord?.length,
			guess_letters: this.guess_letters,
			...withWord,
		};
	}

	getRoomStateForSpectators() {}

	getRoomStateForDrawer() {
		return {
			...this.getRoomStateForGuessers(),
			words: this._words,
			selectedWord: this._selectedWord,
		};
	}

	static getGuessLetters(word: string) {
		const wordLetters = word.split('');
		const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
		const remainingLetters = _.difference(alphabet, wordLetters as string[]);
		const randomLetters = _.sampleSize(remainingLetters, word.length);
		return _.shuffle([...randomLetters, ...wordLetters]);
	}

	setWordSelectionPhase() {
		this.phase = 'WORD_SELECTION';
		this.phase_end_at = dayjs().add(durations.WORD_SELECTION, 'seconds').toISOString();
		this.phase_start_at = dayjs().toISOString();
		this._words = _.sampleSize(words, 3);
		if (this._lastMovePlayerIndex === -1) {
			this.drawing_player = this.players[0];
			this._lastMovePlayerIndex = 0;
		} else {
			const next = this.players[this._lastMovePlayerIndex + 1];
			if (next) {
				this.drawing_player = next;
				this._lastMovePlayerIndex = this._lastMovePlayerIndex + 1;
			} else {
				this.drawing_player = this.players[0];
				this._lastMovePlayerIndex = 0;
			}
		}
		this._selectedWord = '';
		this.players = this.players.map((p) => ({
			...p,
			guessed: false,
			guessed_seconds: null,
		}));
	}

	setWordNotSelectedPhase() {
		this.phase = 'WORD_NOT_SELECTED';
		this.phase_end_at = dayjs().add(durations.WORD_NOT_SELECTED, 'seconds').toISOString();
		this.phase_start_at = dayjs().toISOString();
	}

	setWordDrawingPhase() {
		this.phase = 'WORD_DRAWING';
		this.phase_end_at = dayjs().add(durations.WORD_DRAWING, 'seconds').toISOString();
		this.phase_start_at = dayjs().toISOString();
		this.guess_letters = ScribbleGameRoom.getGuessLetters(this._selectedWord || '');
	}

	setRoundResults() {
		this.phase = 'ROUND_RESULTS';
		this.phase_end_at = dayjs().add(durations.ROUND_RESULTS, 'seconds').toISOString();
		this.phase_start_at = dayjs().toISOString();
		if (this.round === 4) {
			console.log('can terminate room here');
			// should switch to a seperate phase, but it's for tomorrow
			this.setRoomGatheringPhase();
		}
	}

	setRoomGatheringPhase() {
		this.phase = 'ROOM_GATHERING';
		this._selectedWord = '';
		this.drawing_json = '';
		this.round = 1;
		this.phase_end_at = dayjs().add(durations.ROOM_GATHERING, 'seconds').toISOString();
		this.phase_start_at = dayjs().toISOString();
		this.players = this.players.map((p) => ({
			...p,
			guessed: false,
			guessed_seconds: null,
		}));
	}

	isPhaseExpired() {
		return dayjs().isSame(this.phase_end_at) || dayjs().isAfter(this.phase_end_at);
	}

	processState() {
		if (this.phase === 'ROOM_GATHERING') {
			// process to next phase as soon as there are at least 2 players
			if (this.players.length >= 2) {
				this.setWordSelectionPhase();
			}
		}

		if (this.phase === 'WORD_SELECTION') {
			if (this.isPhaseExpired()) {
				if (!this._selectedWord) {
					this.broadcast({
						type: 'room:alert',
						payload: {
							emoji: '😞',
							content: `${this.drawing_player?.username} did not select a word`,
						},
					});
					if (this.round === 4) {
						// should set results here already
						this.setRoomGatheringPhase();
					} else {
						this.round = this.round + 1;
						this.setWordSelectionPhase();
					}
				}
			} else {
				if (this._selectedWord) {
					this.setWordDrawingPhase();
				}
			}
		}

		if (this.phase === 'WORD_NOT_SELECTED') {
			if (this.isPhaseExpired()) {
				// reset to room gathering?
				this.setRoomGatheringPhase();
			}
		}

		if (this.phase === 'WORD_DRAWING') {
			if (this.isPhaseExpired()) {
				this.setRoundResults();
			} else {
				// if all but the drawer guessed the word, finish phase in 5 seconds
				const guessersRemaining = this.players.some((p) => !p.guessed && p.id !== this.drawing_player?.id);
				if (!guessersRemaining) {
					const newPhaseEnd = dayjs().add(5, 'seconds');
					if (newPhaseEnd.isBefore(dayjs(this.phase_end_at))) {
						this.phase_end_at = newPhaseEnd.toISOString();
					}
				}
			}
		}

		if (this.phase === 'ROUND_RESULTS') {
			if (this.isPhaseExpired()) {
				this.round = this.round + 1;
				this.setWordSelectionPhase();
			}
		}
	}

	async handleWebSocketSession(webSocket: WebSocket, request: Request) {
		const url = new URL(request.url);
		const authData = url.searchParams.get('auth');

		const user = auth(authData as string, request.headers.get('bot_token') as string);

		webSocket.accept();

		const webSocketId = crypto.randomUUID();

		//@ts-ignore
		webSocket.id = webSocketId;

		const player = {
			sockets: [webSocket],
			username: formatName(user),
			id: user.id,
			imageUrl: `https://telegram-avatar.bermanoleg.workers.dev/?id=${user.id}`,
			joined_at: dayjs().toISOString(),
			score: 0,
			guessed_seconds: null,
		};

		const playerExists = this.players.some((p) => p.id === player.id);

		if (playerExists) {
			this.players = this.players.map((p) =>
				p.id === player.id
					? {
							...p,
							sockets: [...p.sockets, webSocket],
					  }
					: p
			);
		} else {
			this.players.push(player);
		}

		// broadcast state first time right after connection
		this.broadcastState();

		webSocket.addEventListener('message', this.handleMessage(player.id));

		webSocket.addEventListener('close', this.handleClose(player.id, webSocketId));

		webSocket.addEventListener('error', (error) => {
			console.log('WS Error', error);
			this.handleClose(player.id, webSocketId)();
		});
	}

	handleMessage = (playerId: number) => async (msg) => {
		try {
			const message = JSON.parse(msg.data as string);
			switch (message.type) {
				case 'word_select':
					if (this.phase === 'WORD_SELECTION') {
						if (this._words?.includes(message.payload.word)) {
							this._selectedWord = message.payload.word.toLowerCase();
						}
					}
					break;

				case 'word_draw':
					if (this.phase === 'WORD_DRAWING') {
						this.drawing_json = message.payload.drawing_json;
						this.broadcastState();
					}
					break;

				case 'word_guess':
					if (this.phase === 'WORD_DRAWING') {
						const correct = message.payload.word.toLowerCase() === this._selectedWord?.toLowerCase();
						this.emitToPlayer(playerId, {
							type: 'guess:result',
							payload: {
								correct,
							},
						});

						if (correct) {
							const player = this.players.find((p) => p.id === playerId);
							const guessed_seconds = dayjs().diff(this.phase_start_at, 'seconds');

							this.players = this.players.map((p) =>
								p.id === playerId
									? {
											...p,
											guessed: true,
											guessed_seconds: guessed_seconds,
											score: p.score + 1,
									  }
									: p
							);

							this.broadcast({
								type: 'room:alert',
								payload: {
									emoji: '🎉',
									content: `${player?.username} guessed the word!`,
								},
							});
						} else {
							this.emitToPlayer(playerId, {
								type: 'room:alert',
								payload: {
									emoji: '😞',
									content: `Incorrect word! Try again!`,
								},
							});
						}
					}
					break;

				case 'new_words':
					if (this.phase === 'WORD_SELECTION') {
						// check if current player requests new words
						const player = this.players.find((p) => p.id === playerId);
						if (this.drawing_player?.id === player?.id) {
							this._words = _.sampleSize(words, 3);
						}
					}
					break;

				case 'reaction':
					if (['WORD_DRAWING', 'ROUND_RESULTS'].includes(this.phase)) {
						this.broadcast({
							type: 'room:reaction',
							payload: {
								id: `reaction-${Math.random().toString()}`,
								emoji: message.payload.emoji,
								fromPlayerId: playerId,
							},
						});
					}

					break;
			}
		} catch (err) {
			console.log(err);
			console.log('invalid json in websocket message');
		}
	};

	handleClose = (id: number, webSocketId: string) => () => {
		// if last socket of this player, then schedule a deletion of that player from the game
		this.players = this.players.map((player) =>
			id === player.id
				? {
						...player,
						sockets: player.sockets.filter((socket) => socket.id !== webSocketId),
				  }
				: player
		);

		const disconnectedPlayer = this.players.find((player) => id === player.id);
		if (disconnectedPlayer?.sockets.length === 0) {
			setTimeout(this.checkPresenceAndDeleteIfDisconnected(id), 10000);
		}
	};

	checkPresenceAndDeleteIfDisconnected = (playerId: number) => () => {
		const player = this.players.find((player) => playerId === player.id);
		if (player?.sockets.length === 0) {
			this.players = this.players.filter((p) => p.id !== playerId);
		}
	};

	emitToPlayer(playerId: number, msg: any) {
		for (let player of this.players) {
			if (player.id === playerId) {
				for (let socket of player.sockets) {
					socket.send(JSON.stringify(msg));
				}
			}
		}
	}

	broadcast(msg: any) {
		for (let player of this.players) {
			for (let socket of player.sockets) {
				socket.send(JSON.stringify(msg));
			}
		}
	}

	broadcastState() {
		for (let player of this.players) {
			if (player.id === this.drawing_player?.id) {
				for (let socket of player.sockets) {
					socket.send(
						JSON.stringify({
							type: 'room:state',
							payload: this.getRoomStateForDrawer(),
						})
					);
				}
			} else {
				for (let socket of player.sockets) {
					socket.send(
						JSON.stringify({
							type: 'room:state',
							payload: this.getRoomStateForGuessers(),
						})
					);
				}
			}
		}
	}

	async onDestroy() {
		console.log('DO is being destroyed');
		clearInterval(this.broadcastInterval);
	}
}
