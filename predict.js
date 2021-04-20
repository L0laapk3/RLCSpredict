
const readline = require('readline');
const assert = require('assert');

const got = require('got');
const { PromiseWorker } = require('promise-workers');
const ts = new (require('ts-trueskill').TrueSkill)(undefined, undefined, undefined, 25/3/100/5, 0);


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

function winProbabilityInterval(ts, a, b, confidence) {

	const deltaMu = a.reduce((t, cur) => t + cur.mu, 0) - b.reduce((t, cur) => t + cur.mu, 0);
	const sumSigma = a.reduce((t, n) => n.sigma ** 2 + t, 0) + b.reduce((t, n) => n.sigma ** 2 + t, 0);
	const playerCount = a.length + b.length;
	const denominator = Math.sqrt(playerCount * (ts.beta * ts.beta + sumSigma));
	
	const sigmaOffsetMul = ts.guassian.ppf(confidence / 2 + .5);
	const sigmaOffset = Math.sqrt(sumSigma / playerCount) * sigmaOffsetMul;
	console.log(Math.sqrt(sumSigma) / denominator);
	return [ts.guassian.cdf((deltaMu - sigmaOffset) / denominator), ts.guassian.cdf((deltaMu + sigmaOffset) / denominator)];
}

function winProbabilityCertainty(ts, a, b) {
	const deltaMu = a.reduce((t, cur) => t + cur.mu, 0) - b.reduce((t, cur) => t + cur.mu, 0);
	const sumSigma = a.reduce((t, n) => n.sigma ** 2 + t, 0) + b.reduce((t, n) => n.sigma ** 2 + t, 0);
	const playerCount = a.length + b.length;
	const denominator = Math.sqrt(playerCount * (ts.beta * ts.beta + sumSigma));
	return { p: ts.guassian.cdf(deltaMu / denominator), s: Math.sqrt(sumSigma) / denominator };
}


function NChooseK(n, k) {
    var result = 1;
    for(var i=1; i <= k; i++)
        result *= (n+1-i)/i;
    return result;
}




(async ()=> {

const threadP = new PromiseWorker(async resolve => {
	const fs = require('fs');
	const got = require('got');
	const ts = new (require('ts-trueskill').TrueSkill)(workerData.mu, workerData.sigma, workerData.beta, workerData.tau, 0);
	
	const allMatches = JSON.parse(await fs.promises.readFile("allgames.json"));
	const allPlayers = {};

	let additions = false;
	let page = 0;
	const perPage = 200;
	const startDate = allMatches.length ? allMatches[allMatches.length-1].date : 0;
	while (true) {
		const matches = (await got(`https://zsr.octane.gg/matches?sort=date:asc&after=${startDate}&perPage=${perPage}&page=${++page}`).json()).matches;
		if (!matches)
			break;
		
		for (let match of matches)
			if (match.date && allMatches.every(m => match._id != m._id)) {
				allMatches.push(match);
				additions = true;
			}

		if (matches.length < perPage)
			break;

		console.log("downloaded page ", page);
		if (page % 10 == 0 && additions) {
			fs.writeFile("allgames.json", JSON.stringify(allMatches), _ => {});
			additions = false;
		}
	}

	if (additions)
		fs.writeFile("allgames.json", JSON.stringify(allMatches), _ => {});

	for (let match of allMatches) {
		if (!match.format)
			continue;
		if (match.format.type != "best") {
			console.log(match.format.type);
			continue;
		}
		if (!match.games || !match.format)
			continue;
		if (!match.orange.players || !match.blue.players)
			continue;
		if (match.orange.players.length != 3 || match.blue.players.length != 3)
			continue;
		const participants = [match.blue.players, match.orange.players].map(l => l.map(p => p.player._id));
		
		for (const game of match.games) {
			if (game.blue < game.orange)
				participants.reverse();
			results = ts.rate(participants.map(l => l.map(p => allPlayers[p] || ts.createRating())));
			for (let t = 0; t < 2; t++)
				for (let i = 0; i < participants[t].length; i++)
					allPlayers[participants[t][i]] = results[t][i];
			if (game.blue < game.orange)
				participants.reverse();
			
			// if ([].concat(...participants).includes("5f3d8fdd95f40596eae23dca"))
			// 	console.log(allPlayers["5f3d8fdd95f40596eae23dca"].mu, allPlayers["5f3d8fdd95f40596eae23dca"].sigma);
		}
	}

	for (let pid in allPlayers)
		allPlayers[pid] = { mu: allPlayers[pid].mu, sigma: allPlayers[pid].sigma };

	resolve(allPlayers);
}, {workerData: {mu: ts.mu, sigma: ts.sigma, tau: ts.tau, beta: ts.beta}});

const updateP = new Promise(async resolve => {
	const allPlayers = await threadP;
	for (let pid in allPlayers)
		allPlayers[pid] = ts.createRating(allPlayers[pid].mu, allPlayers[pid].sigma);
	resolve(allPlayers);
});





const teamsP = got("https://zsr.octane.gg/teams").json();

const P = [];
const shortnames = [];
const teams = [];
const players = [];
for (let i = 0; i < 2; i++) {
	shortnames[i] = await prompt("team " + (i + 1) + ": ");
	P.push(new Promise(async resolve => {
		const teamF = (await teamsP).teams.filter(t => t.name.toLowerCase().includes(shortnames[i]));
		teamF.map(t => t.key = t.name.length - 1000 * (t.name.toLowerCase().split(" ").some(w => w.substr(0, shortnames[i].length) == shortnames[i])))
		teams[i] = teamF.sort((a, b) => a.key - b.key)[0];
		assert(teams[i]);
		resolve(new Promise(async resolve => {
			const lastGame = (await got("https://zsr.octane.gg/games?sort=date:desc&perPage=1&page=1&team=" + teams[i]._id).json()).games[0];
			players[i] = (lastGame.blue.team.team._id == teams[i]._id ? lastGame.blue : lastGame.orange).players.map(p => p.player);
			assert(players[i].length == 3);
			resolve();
		}));
	}));
}
const P2 = await Promise.all(P);
console.log(`${teams[0].name} vs ${teams[1].name}`);
const pids = players.map(l => l.map(p => p._id));
const ratios = [];
for (let i = 0; i < 2; i++)
	ratios.push(parseFloat(await prompt("team " + (i + 1) + " ratio: 1:")));
const ratioScale = Math.sqrt(ratios.reduce((t, r) => t * (r - 1), 1));
assert(ratioScale > 0.95 && ratioScale < 1.05);
const returnFraq = ratios.map(r => (r - 1) / ratioScale);

await Promise.all(P2);
const allPlayers = await updateP;

for (const team of players)
	for (const player of team)
		console.log(`${player.tag.padStart(16)} ${allPlayers[player._id].mu.toFixed(2)} ${allPlayers[player._id].sigma.toFixed(2)}`);


const playerRatings = pids.map(l => l.map(p => allPlayers[p]));

const CONFIDENCE = 0.8;

// console.log(`Confidence interval: ${CONFIDENCE.toString().substr(1)}`)

const { p: p1, s: s1 } = winProbabilityCertainty(ts, playerRatings[0], playerRatings[1], CONFIDENCE);

for (let i = 1; i < 8; i += 2) {
	let pN = 0;
	// TODO: correlation https://fcic-static.law.stanford.edu/cdn_media/fcic-testimony/2010-0602-exhibit-binomial.pdf
	for (let j = Math.ceil(i / 2); j <= i; j++)
		pN += NChooseK(i, j) * Math.pow(p1, j) * Math.pow(1 - p1, i - j);
	let sN = s1; // TODO
	

	const kelly = (p, b) => p - (1 - p) / b;
	let b = returnFraq[0], pK = pN, bet = kelly(pK, b), betOn = 0;
	if (bet < 0) {
		b = returnFraq[1];
		pK = 1 - pN;
		bet = kelly(pK, b);
		betOn = 1;
	}
	bet *= bet*bet / (bet*bet + ((b+1)/b)**2 * sN**2);
	console.log(`BO${i}   p=${pN.toFixed(3).substr(1)} σ=${sN.toFixed(3).substr(1)}   Bet ${(bet*100).toFixed(2).padStart(5)}% on ${shortnames[betOn]}`);
}

})();