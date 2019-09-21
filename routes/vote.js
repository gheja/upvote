const auth = require('../middleware/auth');
const model = require('../models');
const config = require('../src/config');
const express = require('express');

const router = express.Router();
const VOTE_ROUNDS = parseInt(process.env.VOTE_ROUNDS) || 0;
const VOTE_EXPIRE = parseInt(process.env.VOTE_EXPIRE) || 0;
const VOTE_AVAILABLE = parseInt(process.env.VOTE_AVAILABLE) || 0;

function getTime(date, time) {
  return time ? time * 1000 + date.getTime() : false;
}

async function getData(vote) {
  vote.Entries.sort((a, b) => a.seed - b.seed);
  const comments = await vote.findComments();
  return {
    login: vote.login,
    result: vote.result,
    entries: vote.Entries.map(entry => ({...entry.data, id: entry.id})),
    comments: comments.map(comment => ({id: comment.EntryId, message: comment.message})),
    createdAt: vote.createdAt.getTime(),
    availableAt: getTime(vote.createdAt, VOTE_AVAILABLE),
    expireAt: getTime(vote.createdAt, VOTE_EXPIRE)
  };
}

router.get('/', auth(false), async (req, res) => {
  const vote = await model.Vote.findActive(req.user.login);
  if (!vote) {
    throw new Error("error_no_active_vote");
  }
  res.send({ data: await getData(vote) });
});

router.get('/:id', auth(false), async (req, res) => {
  const vote = await model.Vote.findOne({
    where: {
      id: req.params.id,
      login: req.user.login,
    },
    include: {
      model: model.Entry
    }
  });
  if (!vote) {
    return res.status('404').send({ error: 'error_vote_not_found' });
  }
  res.send({ data: await getData(vote) });
});

router.post('/', auth(false), async (req, res) => {
  const login = req.user.login;
  let vote = await model.Vote.findActive(login);
  if (VOTE_EXPIRE && !vote && await model.Vote.pickExpired(login, VOTE_EXPIRE)) {
    vote = await model.Vote.findActive(login);
  }
  if (!vote && await model.Vote.createActive(VOTE_ROUNDS, login)) {
    vote = await model.Vote.findActive(login);
  }
  if (!vote) {
    throw new Error("error_no_vote_left");
  }
  res.send({ data: getData(vote) });
});

router.patch('/', auth(false), async (req, res) => {
  const login = req.user.login;
  const vote = await model.Vote.findActive(login);
  vote.Entries.sort((a, b) => a.seed - b.seed);
  if (!vote) {
    throw new Error("error_no_active_vote");
  }
  if (VOTE_AVAILABLE && getTime(vote.createdAt, VOTE_AVAILABLE) > new Date().getTime()) {
    throw new Error("error_vote_not_available");
  }
  await vote.saveResult(req.body.result, config.criteria.length);
  if (req.body.comments instanceof Array) {
    const entries = await vote.getEntries();
    entries.forEach(async (entry, i) => {
      const message = typeof req.body.comments[i] === 'string'
        ? req.body.comments[i].trim()
        : '';
      if (message !== '') {
        await entry.saveComment(login, message);
      }
    });
  }
  res.send({ data: vote.id });
});

module.exports = router;