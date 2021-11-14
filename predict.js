
const readline = require('readline');
const assert = require('assert');

const fs = require('fs');
const got = require('got');
const { PromiseWorker } = require('promise-workers');
const { Abba } = require('abbajs');
const Integral = require('sm-integral');
const TrueSkill = require('ts-trueskill').TrueSkill;

const RHO = 0;


function prompt(query) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout, 
	});

	return new Promise(resolve => rl.question(query, ans => {
		rl.close();
		resolve(ans.toLowerCase());
	}));
}


const N0 = new Abba.NormalDistribution(0, 1);
function winProbabilityDists(ts, a, b) {
	const deltaMu = a.reduce((t, cur) => t + cur.mu, 0) - b.reduce((t, cur) => t + cur.mu, 0);
	const sumSigma = a.reduce((t, n) => n.sigma ** 2 + t, 0) + b.reduce((t, n) => n.sigma ** 2 + t, 0);
	const playerCount = a.length + b.length;
	const denominator = Math.sqrt(playerCount * ts.beta * ts.beta + sumSigma);
	// console.log("old formula: ", N0.cdf(deltaMu / denominator));
	// console.log("old formula alt: ", N0.cdf(deltaMu / Math.sqrt(playerCount * ts.beta * ts.beta)));

	const sSkill = Math.sqrt(sumSigma);
	const NSkill = new Abba.NormalDistribution(deltaMu, sSkill);

	const sUncertainty = Math.sqrt(playerCount) * ts.beta;
	const NUncertainty = new Abba.NormalDistribution(0, sUncertainty);

	const M = 4;
	return {
		NSkill: NSkill,
		NUncertainty: NUncertainty,
		range: {
			min: Math.min(deltaMu - M * sSkill, -M * sUncertainty),
			max: Math.max(deltaMu + M * sSkill,  M * sUncertainty),
		},
	};

	// console.log(deltaMu, denominator, N0.cdf(deltaMu / denominator));
	// const N = new Abba.NormalDistribution(-deltaMu / denominator, 1); 
	// return p => N0.density(N.inverseCdf(p));
	
    // denominator = math.sqrt(playerCount * (BETA * BETA) + sumSigma)             
    // return N0.cdf(deltaMu / denominator)
	// return x => new Abba.NormalDistribution(0, denominator).cdf(deltaMu + x);
}

function bestOfN(n, firstGame) {
	if (firstGame)
		n--;
	return p1 => {
		let pN = 0;
		for (let j = Math.ceil(n / 2) + (firstGame == -1 ? 1 : 0); j <= n; j++)
			pN += NChooseK(n, j) * Math.pow(p1, j) * Math.pow(1 - p1, n - j);
		return pN;
	};

	// TODO: correlation https://fcic-static.law.stanford.edu/cdn_media/fcic-testimony/2010-0602-exhibit-binomial.pdf
	// const k = (n - 1) / 2;
	// for (let j = 0; j < n - k; j++) {
	// 	let v = x;
	// 	for (let w = 2; w < j + k; w++) {
	// 		v *= (1 - (1 - x) * Math.pow(1 - RHO, w - 1));
	// 	}
	// 	xN += Math.pow(-1, j) * NChooseK(n - k, j) * v;
	// }
	// xN *= NChooseK(n, k);
}

function optimalBet(dists, boN, returnFraq) {
	console.log(returnFraq);
	const P = x => dists.NSkill.density(x) * boN(dists.NUncertainty.cdf(x));
	let betOn = 0;

	
	const kelly = (p, b) => p - (1 - p) / b;
	const profitFn = k => Integral.integrate(x => {
		let p = betOn ? 1 - P(x) : P(x);
		let bet = k * kelly(p, returnFraq[betOn]);
		return bet * p * returnFraq[betOn];
	}, dists.range.min, dists.range.max);
	if (profitFn(1) < 0)
		betOn = 1;

	let minX = 0, minY = 0;
	let maxX = 1, maxY = profitFn(maxX);
	let x, y;
	for (let i = 0; i < 20; i++) {
		x = (minX + maxX) / 2;
		y = profitFn(x);
		console.log([minX, x, maxX], [minY, y, maxY]);
		if (y < maxY) {
			minX = x;
			minY = y;
		} else if (y < minY) {
			maxX = x;
			maxY = y;
		} else {
			minX = (minX + x) / 2;
			minY = profitFn(minX);
			maxX = (maxX + x) / 2;
			maxY = profitFn(maxX);
		}
	}
}

function winProbabilityMeanStd(dists, boN) {
	const mean = Integral.integrate(x => dists.NSkill.density(x) * boN(dists.NUncertainty.cdf(x)), dists.range.min, dists.range.max);
	return {
		mean: mean,
		var: Integral.integrate(x => dists.NSkill.density(x) * (boN(dists.NUncertainty.cdf(x)) - mean)**2, dists.range.min, dists.range.max),
	};
}

// function meanStd(P) {
// 	const scale = Integral.integrate(P, 0, 1);
// 	const PScale = x => P(x) / scale;
// 	const mean = Integral.integrate(x => x * PScale(x), 0, 1);
// 	const stddev = Math.sqrt(Integral.integrate(x => x**2 * PScale(x), 0, 1) - mean**2);

// 	return { p: mean, s: stddev };
// }
// function winProbabilityCertainty(ts, a, b) {
// 	const P = winProbabilityFunction(ts, a, b);
// 	return meanStd(P);
// }


function NChooseK(n, k) {
    var result = 1;
    for(var i=1; i <= k; i++)
        result *= (n+1-i)/i;
    return result;
}





(async ()=> {
	
const ts = new TrueSkill(undefined, undefined, 10, undefined, 0);

const loadP = new Promise(async resolve => {

	let matchesJson;
	try {
		matchesJson = JSON.parse(await fs.promises.readFile("matches.json"));
	} catch (ex) {
		console.warn("Couldn't find the matches database. Downloading will take 5 minutes or so.");
		matchesJson = {
			lastDate: 0,
			matches: [],
		};
	}
	const allMatches = matchesJson.matches;

	const oldMatchCount = allMatches.length;
	let additions = false;
	let page = 0;
	const perPage = 50;
	const startDate = matchesJson.lastDate;
	while (true) {
		const matches = (await got(`https://zsr.octane.gg/matches?sort=date:asc&after=${startDate}&perPage=${perPage}&page=${++page}`).json()).matches;
		if (!matches)
			break;
		
		for (let match of matches) {
			if (match.date && allMatches.every(m => match._id != m._id)) {
				if (!match.format)
					continue;
				if (match.format.type != "best" && match.format.type != "set") {
					console.log("unknown format: " + match.format.type);
					continue;
				}
				if (!match.games || !match.format)
					continue;
				if (!match.orange.players || !match.blue.players)
					continue;
				if (match.orange.players.length != 3 || match.blue.players.length != 3)
					continue;
				allMatches.push({
					_id: match._id,
					players: [match.blue.players, match.orange.players].map(l => l.map(p => p.player._id)),
					games: match.games.map(m => ({
						blue: m.blue,
						orange: m.orange
					})),
					format: match.format,
					blueWin: !!match.blue.winner,
				});
				if (match.date)
					matchesJson.lastDate = match.date;
				additions = true;
			}
		}

		if (matches.length < perPage)
			break;

		if ((page - 1) % 5 == 0 && additions) {
			console.log(`downloaded ${page*perPage} matches, currently at ${matchesJson.lastDate}`);
			if (additions)
				fs.writeFile("matches.json", JSON.stringify(matchesJson), _ => {});
			additions = false;
		}
	}

	if (additions) {
		console.log(`downloaded ${allMatches.length - oldMatchCount} matches.`);
		fs.writeFile("matches.json", JSON.stringify(matchesJson), _ => {});
	}
	resolve(allMatches);
});


const updateThreadPF = allMatches => new PromiseWorker(async resolve => {
	const fs = require('fs');
	const got = require('got');
	const TrueSkill = require('ts-trueskill').TrueSkill;
	const ts = new TrueSkill(workerData.mu, workerData.sigma, workerData.beta, workerData.tau, 0);
	const allMatches = workerData.allMatches;

	const allPlayers = {};

	let score = 0;
	let totalScore = 0;

	for (let match of allMatches) {	
		
		const playersRatings = match.players.map(l => l.map(p => allPlayers[p] || ts.createRating()));
		
		// if (match.format.type == "best" && false) {
		// 	const P1 = winProbabilityFunction(ts, playersRatings[0], playersRatings[1]);
		// 	const PN = winProbabilityBestOfFunction(P1, match.format.length);
		// 	const { p: pN, s: sN } = meanStd(PN);
		// 	score += (match.blueWin ? pN : 1 - pN) / sN**2;
		// 	totalScore += 1 / sN**2;
		// }

		for (const game of match.games) {
			results = ts.rate(game.blue < game.orange ? [playersRatings[1], playersRatings[0]] : playersRatings);
			for (let t = 0; t < 2; t++)
				playersRatings[t] = results[game.blue < game.orange ? 1 - t : t];
		}
		
		for (let t = 0; t < 2; t++)
			for (let i = 0; i < match.players[t].length; i++)
				allPlayers[match.players[t][i]] = playersRatings[t][i];
	}

	for (let pid in allPlayers)
		allPlayers[pid] = { mu: allPlayers[pid].mu, sigma: allPlayers[pid].sigma };

	score /= totalScore;

	resolve({ allPlayers, score });
}, {workerData: { mu: ts.mu, sigma: ts.sigma, tau: ts.tau, beta: ts.beta, allMatches: allMatches }});

const updateP = new Promise(async resolve => {
	const allMatches = await loadP;
	const { allPlayers, score } = await updateThreadPF(allMatches);
	// console.log("score:", score);
	for (let pid in allPlayers)
		allPlayers[pid] = ts.createRating(allPlayers[pid].mu, allPlayers[pid].sigma);
	resolve(allPlayers);
});





const points = parseFloat(await prompt("total points (k): "));

const P = [];
const shortnames = [];
const teams = [];
const players = [];
for (let i = 0; i < 2; i++)
	shortnames[i] = await prompt(`team ${i + 1}: `);

const subs = [];
let askSub = true;
while (askSub) {
	const sub = await prompt("sub: ");
	if (askSub = sub.length) {
		const subWith = await prompt(`sub ${sub} with: `);
		if (askSub = subWith.length)
			subs.push([sub, got(`https://zsr.octane.gg/players?tag=${subWith}`).json(), subWith.toLowerCase()]);
	}
}

for (let i = 0; i < 2; i++) {
	P.push(new Promise(async resolve => {
		const teamsP = await got(`https://zsr.octane.gg/teams?name=${shortnames[i]}`).json();
		const teamF = (await teamsP).teams;
		teamF.map(t => 
			t.key = t.name.length
			- 1000 * (t.name.toLowerCase().split(" ").some(w => w.substr(0, shortnames[i].length) == shortnames[i]))
			- 9000 * (t.name.toLowerCase().split(" ").some(w => w == shortnames[i]))
			- 90000 * (t.relevant ? 1 : 0)
		);
		teams[i] = teamF.sort((a, b) => a.key - b.key)[0];
		assert(teams[i]);
		resolve(new Promise(async resolve => {
			const lastGames = (await got("https://zsr.octane.gg/games?sort=date:desc&perPage=1&page=1&team=" + teams[i]._id).json()).games;
			if (lastGames && lastGames.length > 0)
				players[i] = (lastGames[0].blue.team.team._id == teams[i]._id ? lastGames[0].blue : lastGames[0].orange).players.map(p => p.player);
			else 
				players[i] = (await got("https://zsr.octane.gg/players?team=" + teams[i]._id).json()).players;

			assert(players[i].length == 3);
			for (let j = 0; j < 3; j++) {
				const sub = subs.find(s => players[i][j].tag.toLowerCase() == s[0]);
				if (sub) {
					players[i][j] = (await sub[1]).players.find(p => p.tag.substr(0, sub[2].length).toLowerCase() == sub[2]);
					players[i][j].tag += "*";
				}
			}

			resolve();
		}));
	}));
}


const P2 = await Promise.all(P);
console.log(`${teams[0].name} vs ${teams[1].name}`);
const pids = players.map(l => l.map(p => p._id));

let firstLoop = true;
while (true) {
	const ratios = [];
	for (let i = 0; i < 2; i++)
		ratios.push(parseFloat(await prompt("team " + (i + 1) + " ratio: 1:")));

	const adjSol = (Math.sqrt(ratios[0]**2 - 2*ratios[0]*ratios[1] + ratios[1]*ratios[1] + 4) - ratios[0] - ratios[1] + 2) / 2;
	if (Math.abs(adjSol) > 0.2) {
		console.warn("WARNING: ratios are off by a lot, might be a typo");
	}
	ratios[0] += adjSol;
	ratios[1] += adjSol;

	const returnFraq = ratios.map(r => r - 1);

	await Promise.all(P2);
	const allPlayers = await updateP;

	if (firstLoop) {
		console.log("```py");
		for (const team of players)
			for (const player of team)
				console.log(`${player.tag.padStart(16)} ${allPlayers[player._id].mu.toFixed(2)} ${allPlayers[player._id].sigma.toFixed(2)}`);
		firstLoop = false;
		console.log("```");
	}



	const playerRatings = pids.map(l => l.map(p => allPlayers[p]));



	const WP1Dists = winProbabilityDists(ts, playerRatings[0], playerRatings[1]);
	// const { mean: p1, var: v1 } = winProbabilityMeanStd(WP1Dists, x => x);
	// console.log(p1, Math.sqrt(v1));


	for (let printFirstGameWin = 1; printFirstGameWin >= 0; printFirstGameWin--) {
		const bets = [];
		console.log("```py");
		console.log(`${teams[0].name} 1:${(returnFraq[0]+1).toFixed(3)} vs 1:${(returnFraq[1]+1).toFixed(3)} ${teams[1].name}`);
		for (let j = 1; j <= 2; j++) {
			for (let i = j == 2 ? 7 : printFirstGameWin ? 5 : 1; i < 8; i += 2) {
				for (let firstGame = -printFirstGameWin; firstGame <= printFirstGameWin; firstGame++) {
					const boNFirst = bestOfN(i, firstGame);
					let boN = boNFirst;
					if (j == 2) {
						const boNRest = bestOfN(i);
						const bo3_1 = bestOfN(3, 1), bo3_0 = bestOfN(3, -1);
						boN = p1 => {
							const pFirst = boNFirst(p1), pRest = boNRest(p1);
							return pFirst * bo3_1(pRest) + (1 - pFirst) * bo3_0(pRest);
						};
					}
						
					// optimalBet(WP1Dists, boN, returnFraq);

					const { mean: pN, var: vN } = winProbabilityMeanStd(WP1Dists, boN);
					

					const kelly = (p, b) => p - (1 - p) / b;
					let b = returnFraq[0], pK = pN, bet = kelly(pK, b), betOn = 0;
					if (bet < 0) {
						b = returnFraq[1];
						pK = 1 - pN;
						bet = kelly(pK, b);
						betOn = 1;
					}

					const yoloBet = bet;
					// https://www.researchgate.net/publication/262425087_Optimal_Betting_Under_Parameter_Uncertainty_Improving_the_Kelly_Criterion
					bet *= bet*bet / (bet*bet + ((b+1)/b)**2 * vN);

					let name = `BO${i}`;
					if (printFirstGameWin)
						name += firstGame ? `+${shortnames[firstGame == 1 ? 0 : 1].substring(0, 3).padEnd(3)}` : "    ";
					name +=  ` ${j == 1 ? "  " : "S" + j}`;
					
					// console.log(`${name}  p=${pN.toFixed(3).substr(1)} σ=${Math.sqrt(vN).toFixed(3).substr(1)}   Bet ${(bet*100).toFixed(2).padStart(5)}% (yolo ${(yoloBet*100).toFixed(2).padStart(5)}%) on ${shortnames[betOn]}`);
					console.log(`${name}  p=${pN.toFixed(3).replace("1.000", "1.00")} σ=${Math.sqrt(vN).toFixed(3).substr(1)}   Bet ${(bet*100).toFixed(2).padStart(5)}% on ${shortnames[betOn]}`);
					bets.push({
						name: name,
						p: pN,
						s: Math.sqrt(vN),
						bet: bet,
						on: shortnames[betOn]
					});
				}
			}
		}
		console.log("```");

		for (line of bets)
			console.log(`${line.name}   Bet ${Math.min(250000, line.bet*points*1000).toFixed(0).padStart(6)} on ${line.on}`);
	}
}


})();