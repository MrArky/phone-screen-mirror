'use strict';
// AUTO-EXTRACTED from RPiPlay lib/fairplay_playfair.c (GPLv3). Do not edit by hand.
const REPLY_MESSAGES = [
  Buffer.from('RlBMWQMBAgAAAACCAgAPnz+eCiUh298xKrK/sp6NIytjdqjIGHAdIq6T2Cc3/q+dtP30HC26nR9Jyqq/ZZGsH3vG9+BmPSGv4BVllT6rgfQYzu0JWtt8PQ4lSQmnmDHUnDmClzQ0+stCxjoc2RGm/pQaim1KdDtGw6dknkTHiVXknYFVAJVJxOL3o/bVug==', 'base64'),
  Buffer.from('RlBMWQMBAgAAAACCAgHPMqJXFLJST4qgrXrxZON7z0Qk4gAEfvwK1nr82V3tHCcwu1kbli7WOpxN7Yi6j8eN5k2RzP1ce1baiOMfXM6vx0MZlaAWZaVOGTnSW5TbZLnkXY0GPh5q8H6WVhYrDvpAQnXqWkTZWRxyVrn75lE4mLgCJ3IZiFcWUJQq2UZoig==', 'base64'),
  Buffer.from('RlBMWQMBAgAAAACCAgLBaaNS7u01sYzdnFjWTxbBUZqJ61MXvQ1DNs1o9jj/nQFqW1K3+pIWsrZUgseERBGBIaLH/tg9txGekYKq19GMcGPipFdVWRCvng78djR9FkBDgH9YHuT75Cyp3twbXrKjqj0uzVnn7ucLNinyKv0WHYdzU925mtyOBwBuVvhQzg==', 'base64'),
  Buffer.from('RlBMWQMBAgAAAACCAgOQAeFyfg9X+fWIDbEEpiV6I/XP/xq74ekwRSUa+5frn8ABHr4POoHfW2kddqyy96XHCOPTKPVrs5295fKcihf0gUh+OuhjxngyVCLm944WbRiqf9Y2JYvOKHJvZh9ziJPORDEeS+bAU1GT5e9y6GhiM3KcIn2CDJmURdiSRsjDWQ==', 'base64'),
];
const FP_HEADER = Buffer.from('RlBMWQMBBAAAAAAU', 'base64');
module.exports = { REPLY_MESSAGES, FP_HEADER };
