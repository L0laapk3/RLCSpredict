
const readline = require('readline');
const assert = require('assert');

const got = require('got');
const { PromiseWorker } = require('promise-workers');
const { Abba } = require('abbajs');
const Integral = require('sm-integral');
const ts = new (require('ts-trueskill').TrueSkill)(undefined, undefined, undefined, 25/3/100/8, 0);


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
function winProbabilityCertainty(ts, a, b) {
	const deltaMu = a.reduce((t, cur) => t + cur.mu, 0) - b.reduce((t, cur) => t + cur.mu, 0);
	const sumSigma = a.reduce((t, n) => n.sigma ** 2 + t, 0) + b.reduce((t, n) => n.sigma ** 2 + t, 0);
	const playerCount = a.length + b.length;
	const denominator = Math.sqrt(playerCount * ts.beta * ts.beta + sumSigma);

	const N = new Abba.NormalDistribution(deltaMu / denominator, Math.sqrt(sumSigma) / denominator);
	const P = x => N.density(N0.inverseCdf(x));
	const scale = Integral.integrate(P, 0, 1);
	const PScale = x => P(x) / scale;
	const mean = Integral.integrate(x => x * PScale(x), 0, 1);
	const stddev = Math.sqrt(Integral.integrate(x => x**2 * PScale(x), 0, 1) - mean**2);

	// console.log(N0.cdf(deltaMu / denominator), mean, stddev);
	// N0.cdf(deltaMu / denominator) is supposed to be equal to mean but its not

	return { p: N0.cdf(deltaMu / denominator), s: stddev };
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
	const allPlayers = {};

	const oldMatchCount = allMatches.length;
	let additions = false;
	let page = 0;
	const perPage = 200;
	const startDate = matchesJson.lastDate;
	while (true) {
		const matches = (await got(`https://zsr.octane.gg/matches?sort=date:asc&after=${startDate}&perPage=${perPage}&page=${++page}`).json()).matches;
		if (!matches)
			break;
		
		for (let match of matches) {
			if (match.date && allMatches.every(m => match._id != m._id)) {
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
				allMatches.push({
					_id: match._id,
					players: [match.blue.players, match.orange.players].map(l => l.map(p => p.player._id)),
					games: match.games.map(m => ({
						blue: m.blue,
						orange: m.orange
					})),
				});
				if (match.date)
					matchesJson.lastDate = match.date;
				additions = true;
			}
		}

		if (matches.length < perPage)
			break;

		if (page % 5 == 0) {
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

	for (let match of allMatches) {		
		for (const game of match.games) {
			if (game.blue < game.orange)
				match.players.reverse();
			results = ts.rate(match.players.map(l => l.map(p => allPlayers[p] || ts.createRating())));
			for (let t = 0; t < 2; t++)
				for (let i = 0; i < match.players[t].length; i++)
					allPlayers[match.players[t][i]] = results[t][i];
			if (game.blue < game.orange)
				match.players.reverse();
			
			// if ([].concat(...match.players).includes("5f3d8fdd95f40596eae23d9b"))
			// 	console.log(allPlayers["5f3d8fdd95f40596eae23d9b"].mu, allPlayers["5f3d8fdd95f40596eae23d9b"].sigma);
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
			const lastGames = (await got("https://zsr.octane.gg/games?sort=date:desc&perPage=1&page=1&team=" + teams[i]._id).json()).games;
			if (lastGames && lastGames.length > 0)
				players[i] = (lastGames[0].blue.team.team._id == teams[i]._id ? lastGames[0].blue : lastGames[0].orange).players.map(p => p.player);
			else 
				players[i] = (await got("https://zsr.octane.gg/players?team=" + teams[i]._id).json()).players;
			
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

const adjSqrt = Math.sqrt(ratios[0]**2 + 2*ratios[0]*(ratios[1]-2) + (ratios[1]-4)*ratios[1]);
const adjSol = [-1, 1].map(i => (i*adjSqrt - ratios[0] + ratios[1]) / 2).reduce((t, r) => Math.abs(r) > Math.abs(t) ? t : r, Infinity);
assert(Math.abs(adjSol) < 0.02);
ratios[0] += adjSol;
ratios[1] -= adjSol;

const returnFraq = ratios.map(r => r - 1);

console.log(`${shortnames[0]} 1:${(returnFraq[0]+1).toFixed(3)} vs 1:${(returnFraq[1]+1).toFixed(3)} ${teams[1].name}`);

await Promise.all(P2);
const allPlayers = await updateP;


const playerRatings = pids.map(l => l.map(p => allPlayers[p]));



const { p: p1, s: s1 } = winProbabilityCertainty(ts, playerRatings[0], playerRatings[1]);

for (let i = 1; i < 8; i += 2) {
	let pN = 0;
	// TODO: correlation https://fcic-static.law.stanford.edu/cdn_media/fcic-testimony/2010-0602-exhibit-binomial.pdf
	for (let j = Math.ceil(i / 2); j <= i; j++)
		pN += NChooseK(i, j) * Math.pow(p1, j) * Math.pow(1 - p1, i - j);
	let sN = Math.sqrt(s1*s1*Math.sqrt(i)); // TODO i just made something up that seemed reasonable-ish
	

	const kelly = (p, b) => p - (1 - p) / b;
	let b = returnFraq[0], pK = pN, bet = kelly(pK, b), betOn = 0;
	if (bet < 0) {
		b = returnFraq[1];
		pK = 1 - pN;
		bet = kelly(pK, b);
		betOn = 1;
	}

	// https://www.researchgate.net/publication/262425087_Optimal_Betting_Under_Parameter_Uncertainty_Improving_the_Kelly_Criterion
	const yoloBet = bet;
	bet *= bet*bet / (bet*bet + ((b+1)/b)**2 * sN**2);

	console.log(`BO${i}   p=${pN.toFixed(3).substr(1)} σ=${sN.toFixed(3).substr(1)}   Bet ${(bet*100).toFixed(2).padStart(5)}% (yolo ${(yoloBet*100).toFixed(2).padStart(5)}%) on ${shortnames[betOn]}`);
}

for (const team of players)
	for (const player of team)
		console.log(`${player.tag.padStart(16)} ${allPlayers[player._id].mu.toFixed(2)} ${allPlayers[player._id].sigma.toFixed(2)}`);

})();