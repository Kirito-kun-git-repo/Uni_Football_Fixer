const Joi = require('joi');

const validateRegistration = (data) => {
    const schema=Joi.object({
        teamName: Joi.string().min(3).max(50).required(),
        collegeName: Joi.string().min(3).max(50).required(),
        email: Joi.string().email().required(),
        password: Joi.string().min(6).max(100).required(),
        logoUrl: Joi.string().optional(),
    })
    return schema.validate(data);
};
const validateLogin = (data) => {
    const schema=Joi.object({
        // username: Joi.string().min(3).max(50).required(),
        email: Joi.string().email().required(),
        password: Joi.string().min(6).max(100).required(),
    })
    return schema.validate(data);
};
module.exports={validateRegistration,validateLogin};